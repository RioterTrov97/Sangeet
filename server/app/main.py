import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from .auth import load_or_create_token
from .extract import Extractor, YtDlpExtractor
from .formats import NoFormat, pick
from .mp4 import find_ranges

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{6,20}$")
SAFETY_MARGIN = 60  # seconds before expiry at which a cached resolve is dropped


def _expires_at(fmt: dict[str, Any]) -> int:
    m = re.search(r"[?&/]expire[=/](\d+)", fmt.get("url", ""))
    return int(m.group(1)) if m else int(time.time()) + 4 * 3600


class Resolved:
    def __init__(self, fmt: dict[str, Any], kind: str):
        self.fmt = fmt
        self.kind = kind
        self.url: str = fmt["url"]
        self.headers: dict[str, str] = {k: v for k, v in (fmt.get("http_headers") or {}).items() if k.lower() in ("user-agent", "accept", "accept-language", "referer", "origin")}
        self.expires = _expires_at(fmt)
        self.content_length = int(fmt.get("filesize") or fmt.get("filesize_approx") or 0)
        self.mime = "video/mp4" if kind == "video" else "audio/mp4"
        self.itag = int(str(fmt.get("format_id", "0")).split("-")[0] or 0)
        self.init: dict[str, int] | None = None
        self.index: dict[str, int] | None = None

    def fresh(self) -> bool:
        return self.expires - SAFETY_MARGIN > time.time()


def create_app(extractor: Extractor | None = None, http: httpx.AsyncClient | None = None, token: str | None = None, data_dir: Path | None = None) -> FastAPI:
    data = data_dir or Path(os.environ.get("SANGEET_DATA_DIR", "data"))
    if token is None:
        token, created = load_or_create_token(data)
        if created:
            print(f"\n*** Sangeet server token (shown once, also saved to {data / 'token'}):\n    {token}\n", flush=True)
    cookies = os.environ.get("SANGEET_COOKIES") or str(data / "cookies.txt")
    ext = extractor or YtDlpExtractor(cookies)
    cache: dict[tuple[str, str], Resolved] = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.http = http or httpx.AsyncClient(timeout=httpx.Timeout(20, read=60), follow_redirects=True)
        yield
        if http is None:
            await app.state.http.aclose()

    app = FastAPI(title="Sangeet server", lifespan=lifespan)

    async def require_token(request: Request) -> None:
        import secrets

        got = request.headers.get("authorization", "")
        if not got.lower().startswith("bearer ") or not secrets.compare_digest(got[7:].strip(), token):
            raise HTTPException(status_code=401, detail="invalid token", headers={"WWW-Authenticate": "Bearer"})

    auth = [Depends(require_token)]

    async def resolve(video_id: str, kind: str, fresh: bool = False) -> Resolved:
        if not VIDEO_ID.match(video_id):
            raise HTTPException(400, "bad video id")
        if kind not in ("audio", "video"):
            raise HTTPException(400, "kind must be audio or video")
        key = (video_id, kind)
        hit = cache.get(key)
        if hit and hit.fresh() and not fresh:
            return hit
        r: Resolved | None = None
        for attempt in range(2):
            try:
                info = await ext.extract(video_id)
                fmt = pick(info, kind)
            except NoFormat as e:
                raise HTTPException(404, str(e))
            except Exception as e:  # yt-dlp raises DownloadError and friends
                raise HTTPException(502, f"extractor failed: {type(e).__name__}: {str(e)[:200]}")
            r = Resolved(fmt, kind)
            if kind == "video" and r.content_length:
                break
            # contentLength / init / sidx straight from the bytes, so the app can build its HLS playlist.
            probe = await app.state.http.get(r.url, headers={**r.headers, "Range": "bytes=0-65535"})
            if probe.status_code in (200, 206):
                total = re.search(r"/(\d+)$", probe.headers.get("content-range", ""))
                if total:
                    r.content_length = int(total.group(1))
                elif not r.content_length:
                    r.content_length = int(probe.headers.get("content-length", 0))
                if kind == "audio":
                    r.init, r.index = find_ranges(probe.content)
                break
            if attempt == 1:
                raise HTTPException(502, f"upstream HTTP {probe.status_code}")
        assert r is not None
        cache[key] = r
        return r

    @app.get("/health", dependencies=auth)
    async def health() -> dict[str, Any]:
        return {"status": "ok", "ytdlp": ext.version(), "cached": len(cache)}

    @app.get("/resolve/{video_id}", dependencies=auth)
    async def resolve_route(video_id: str, kind: str = "audio") -> dict[str, Any]:
        r = await resolve(video_id, kind)
        out: dict[str, Any] = {"url": r.url, "mimeType": r.mime, "contentLength": r.content_length, "expiresAt": r.expires * 1000, "itag": r.itag}
        if r.init:
            out["initRange"] = r.init
        if r.index:
            out["indexRange"] = r.index
        return out

    def parse_range(header: str | None, length: int) -> tuple[int, int] | None:
        if not header or not header.lower().startswith("bytes="):
            return None
        spec = header[6:].split(",")[0].strip()
        a, _, b = spec.partition("-")
        try:
            if a == "":
                n = int(b)
                return max(0, length - n), length - 1
            start = int(a)
            end = int(b) if b else length - 1
        except ValueError:
            return None
        return start, min(end, length - 1)

    @app.get("/stream/{video_id}", dependencies=auth)
    async def stream(video_id: str, request: Request, kind: str = "audio") -> Response:
        r = await resolve(video_id, kind)
        rng = request.headers.get("range")
        parsed = parse_range(rng, r.content_length) if r.content_length else None
        for attempt in range(2):
            headers = {**r.headers, "Accept-Encoding": "identity"}
            if parsed:
                headers["Range"] = f"bytes={parsed[0]}-{parsed[1]}"
            elif r.content_length:
                headers["Range"] = f"bytes=0-{r.content_length - 1}"
            req = app.state.http.build_request("GET", r.url, headers=headers)
            up = await app.state.http.send(req, stream=True)
            if up.status_code in (403, 410) and attempt == 0:
                await up.aclose()
                r = await resolve(video_id, kind, fresh=True)  # URL expired or IP-bound to a previous address
                continue
            break
        if up.status_code not in (200, 206):
            await up.aclose()
            raise HTTPException(502, f"upstream HTTP {up.status_code}")
        out = {"Accept-Ranges": "bytes", "Content-Type": r.mime}
        if "content-length" in up.headers:
            out["Content-Length"] = up.headers["content-length"]
        status = 200
        if parsed and r.content_length:
            status = 206
            out["Content-Range"] = f"bytes {parsed[0]}-{parsed[1]}/{r.content_length}"
        return StreamingResponse(up.aiter_bytes(), status_code=status, headers=out, background=BackgroundTask(up.aclose))

    @app.exception_handler(httpx.HTTPError)
    async def upstream_error(_: Request, exc: httpx.HTTPError) -> JSONResponse:
        return JSONResponse({"detail": f"upstream error: {type(exc).__name__}"}, status_code=502)

    app.state.cache = cache
    return app


def app_factory() -> FastAPI:
    """`uvicorn app.main:app_factory --factory`"""
    return create_app()
