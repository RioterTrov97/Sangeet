"""Finds the DASH init and sidx byte ranges of a fragmented MP4 (itag 140) from its first bytes.

Layout is [ftyp][moov][sidx][moof][mdat]...; the app's HLS playlist needs init = ftyp+moov and index = sidx
(inclusive byte offsets, the same convention YouTube's own manifests use).
"""
import struct


def find_ranges(data: bytes) -> tuple[dict[str, int] | None, dict[str, int] | None]:
    pos = 0
    init_end = None
    index = None
    while pos + 8 <= len(data):
        size, kind = struct.unpack(">I4s", data[pos : pos + 8])
        header = 8
        if size == 1:  # 64-bit size
            if pos + 16 > len(data):
                break
            size = struct.unpack(">Q", data[pos + 8 : pos + 16])[0]
            header = 16
        elif size == 0:
            break
        if size < header:
            break
        if kind == b"moov":
            init_end = pos + size - 1
        elif kind == b"sidx" and index is None:
            index = {"start": pos, "end": pos + size - 1}
        elif kind in (b"moof", b"mdat"):
            break
        pos += size
    init = {"start": 0, "end": init_end} if init_end is not None else None
    return init, index
