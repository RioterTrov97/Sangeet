"""Picks an AVPlayer-compatible format out of a yt-dlp info dict."""
from typing import Any


class NoFormat(Exception):
    pass


def _is_https(f: dict[str, Any]) -> bool:
    return f.get("protocol", "https") in ("https", "http") and bool(f.get("url"))


def pick_audio(info: dict[str, Any]) -> dict[str, Any]:
    """AAC in m4a: itag 140 when offered, else the highest-bitrate m4a audio-only format."""
    cands = [
        f
        for f in info.get("formats", [])
        if _is_https(f) and f.get("vcodec") in (None, "none") and str(f.get("acodec", "")).startswith("mp4a") and f.get("ext") == "m4a"
    ]
    if not cands:
        raise NoFormat("no AAC/m4a audio format")
    for f in cands:
        if str(f.get("format_id")) == "140":
            return f
    return max(cands, key=lambda f: f.get("abr") or 0)


def pick_video(info: dict[str, Any]) -> dict[str, Any]:
    """Progressive mp4 with avc1 video and AAC audio (itag 18 / 22): plays directly in AVPlayer."""
    cands = [
        f
        for f in info.get("formats", [])
        if _is_https(f)
        and f.get("ext") == "mp4"
        and str(f.get("vcodec", "")).startswith("avc1")
        and str(f.get("acodec", "")).startswith("mp4a")
    ]
    if not cands:
        raise NoFormat("no progressive avc1+aac mp4 format")
    return max(cands, key=lambda f: f.get("height") or 0)


def pick(info: dict[str, Any], kind: str) -> dict[str, Any]:
    return pick_video(info) if kind == "video" else pick_audio(info)
