import struct
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app.formats import NoFormat, pick_audio, pick_video
from app.main import create_app
from app.mp4 import find_ranges

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def box(kind: bytes, payload_len: int) -> bytes:
    return struct.pack(">I4s", payload_len + 8, kind) + b"\0" * payload_len


# ftyp(32) moov(120) sidx(60) moof(...) -> init 0..151, index 152..211
FILE = box(b"ftyp", 24) + box(b"moov", 112) + box(b"sidx", 52) + box(b"moof", 40) + bytes(range(256)) * 8
YT = f"https://rr1.googlevideo.com/videoplayback?expire={int(time.time()) + 3600}&itag=140"


def info(url=YT):
    return {
        "formats": [
            {"format_id": "139", "ext": "m4a", "acodec": "mp4a.40.5", "vcodec": "none", "abr": 48, "url": url, "protocol": "https"},
            {"format_id": "140", "ext": "m4a", "acodec": "mp4a.40.2", "vcodec": "none", "abr": 129, "url": url, "protocol": "https", "http_headers": {"User-Agent": "UA"}},
            {"format_id": "251", "ext": "webm", "acodec": "opus", "vcodec": "none", "abr": 130, "url": url, "protocol": "https"},
            {"format_id": "18", "ext": "mp4", "acodec": "mp4a.40.2", "vcodec": "avc1.42001E", "height": 360, "url": url, "protocol": "https", "filesize": len(FILE)},
            {"format_id": "95", "ext": "mp4", "acodec": "mp4a.40.2", "vcodec": "avc1.4d401f", "url": url, "protocol": "m3u8_native"},
        ]
    }


class FakeExtractor:
    def __init__(self):
        self.calls = 0

    async def extract(self, video_id):
        self.calls += 1
        if video_id == "bad_video_id":
            raise RuntimeError("Video unavailable")
        return info()

    def version(self):
        return "2099.01.01"


def upstream(request: httpx.Request) -> httpx.Response:
    rng = request.headers.get("range", "")
    assert request.headers.get("authorization") is None  # our token must never reach YouTube
    if "forbid" in request.url.params.get("x", "") or request.headers.get("user-agent") == "block":
        return httpx.Response(403)
    a, _, b = rng.removeprefix("bytes=").partition("-")
    start, end = int(a or 0), min(int(b) if b else len(FILE) - 1, len(FILE) - 1)
    return httpx.Response(206, content=FILE[start : end + 1], headers={"content-range": f"bytes {start}-{end}/{len(FILE)}", "content-length": str(end - start + 1)})


@pytest.fixture()
def client():
    ext = FakeExtractor()
    app = create_app(extractor=ext, http=httpx.AsyncClient(transport=httpx.MockTransport(upstream)), token=TOKEN)
    with TestClient(app) as c:
        c.ext = ext
        yield c


def test_requires_bearer_token(client):
    assert client.get("/health").status_code == 401
    assert client.get("/health", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/resolve/dQw4w9WgXcQ").status_code == 401
    assert client.get("/stream/dQw4w9WgXcQ").status_code == 401
    r = client.get("/health", headers=AUTH)
    assert r.status_code == 200 and r.json()["ytdlp"] == "2099.01.01"


def test_resolve_audio_returns_aac_with_ranges(client):
    r = client.get("/resolve/dQw4w9WgXcQ?kind=audio", headers=AUTH)
    assert r.status_code == 200
    j = r.json()
    assert j["itag"] == 140 and j["mimeType"] == "audio/mp4"
    assert j["contentLength"] == len(FILE)
    assert j["initRange"] == {"start": 0, "end": 151}
    assert j["indexRange"] == {"start": 152, "end": 211}
    assert j["expiresAt"] > time.time() * 1000


def test_resolve_is_cached_until_expiry(client):
    client.get("/resolve/dQw4w9WgXcQ", headers=AUTH)
    client.get("/resolve/dQw4w9WgXcQ", headers=AUTH)
    assert client.ext.calls == 1


def test_resolve_video_is_progressive_avc1(client):
    j = client.get("/resolve/dQw4w9WgXcQ?kind=video", headers=AUTH).json()
    assert j["itag"] == 18 and j["mimeType"] == "video/mp4"


def test_errors(client):
    assert client.get("/resolve/bad_video_id", headers=AUTH).status_code == 502
    assert client.get("/resolve/dQw4w9WgXcQ?kind=nope", headers=AUTH).status_code == 400
    assert client.get("/resolve/a;b", headers=AUTH).status_code in (400, 404)


def test_stream_supports_ranges(client):
    r = client.get("/stream/dQw4w9WgXcQ", headers={**AUTH, "Range": "bytes=10-19"})
    assert r.status_code == 206
    assert r.content == FILE[10:20]
    assert r.headers["content-range"] == f"bytes 10-19/{len(FILE)}"
    assert r.headers["accept-ranges"] == "bytes"
    tail = client.get("/stream/dQw4w9WgXcQ", headers={**AUTH, "Range": "bytes=-16"})
    assert tail.content == FILE[-16:]
    full = client.get("/stream/dQw4w9WgXcQ", headers=AUTH)
    assert full.status_code == 200 and full.content == FILE


def test_stream_reresolves_once_on_403(client):
    # first resolve hands out a url that upstream rejects (header UA=block), the retry gets a good one
    state = {"n": 0}

    async def flaky(video_id):
        state["n"] += 1
        i = info()
        for f in i["formats"]:
            if f["format_id"] == "140":
                f["http_headers"] = {"User-Agent": "block" if state["n"] == 1 else "UA"}
        return i

    client.ext.extract = flaky
    r = client.get("/stream/dQw4w9WgXcQ", headers={**AUTH, "Range": "bytes=0-7"})
    # the probe inside resolve() hits 403 too (status ignored), then the stream retry re-resolves
    assert r.status_code == 206 and r.content == FILE[:8]
    assert state["n"] == 2


def test_mp4_ranges_and_formats():
    init, index = find_ranges(FILE[:4096])
    assert init == {"start": 0, "end": 151} and index == {"start": 152, "end": 211}
    assert find_ranges(b"junk") == (None, None)
    assert pick_audio(info())["format_id"] == "140"
    assert pick_video(info())["format_id"] == "18"
    with pytest.raises(NoFormat):
        pick_audio({"formats": [{"format_id": "251", "ext": "webm", "acodec": "opus", "vcodec": "none", "url": "u"}]})


def test_token_generated_once(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("SANGEET_TOKEN", raising=False)
    create_app(extractor=FakeExtractor(), data_dir=tmp_path)
    first = (tmp_path / "token").read_text()
    assert first in capsys.readouterr().out
    create_app(extractor=FakeExtractor(), data_dir=tmp_path)
    assert (tmp_path / "token").read_text() == first
    assert first not in capsys.readouterr().out  # printed only on creation
