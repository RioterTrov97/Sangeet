"""yt-dlp wrapper. Kept behind a tiny interface so tests can replace it."""
import asyncio
import os
from typing import Any, Protocol


class Extractor(Protocol):
    async def extract(self, video_id: str) -> dict[str, Any]: ...

    def version(self) -> str: ...


class YtDlpExtractor:
    def __init__(self, cookies_file: str | None = None):
        self.cookies_file = cookies_file if cookies_file and os.path.exists(cookies_file) else None

    def version(self) -> str:
        from yt_dlp.version import __version__

        return __version__

    def _extract_sync(self, video_id: str) -> dict[str, Any]:
        import yt_dlp

        opts: dict[str, Any] = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True}
        if self.cookies_file:
            opts["cookiefile"] = self.cookies_file
        with yt_dlp.YoutubeDL(opts) as ydl:
            return ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)

    async def extract(self, video_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._extract_sync, video_id)
