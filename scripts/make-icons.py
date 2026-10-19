#!/usr/bin/env python3
"""Home-screen icon: a cream shopping cart with a bold check, on terracotta."""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "icons"

BG = (157, 61, 22, 255)
CREAM = (244, 239, 228, 255)
INK = (28, 25, 21, 255)
WHEEL = (28, 25, 21, 255)


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int, pad: float) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x + 0.5, y + 0.5, size, pad))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def in_round_rect(x, y, left, top, right, bottom, radius) -> bool:
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def dist_seg(px, py, ax, ay, bx, by) -> float:
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    if length == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length))
    qx, qy = ax + t * dx, ay + t * dy
    return ((px - qx) ** 2 + (py - qy) ** 2) ** 0.5


def pixel(x: float, y: float, size: int, pad: float) -> tuple[int, int, int, int]:
    left = size * pad
    top = size * pad
    box = size * (1 - 2 * pad)
    # Cart sits in the content box.
    bx0 = left + box * 0.08
    bx1 = left + box * 0.70
    by0 = top + box * 0.30
    by1 = top + box * 0.66
    radius = box * 0.08
    thick = box * 0.075

    handle = dist_seg(
        x, y,
        left + box * 0.58, top + box * 0.36,
        left + box * 0.78, top + box * 0.10,
    ) <= thick or dist_seg(
        x, y,
        left + box * 0.78, top + box * 0.10,
        left + box * 0.96, top + box * 0.24,
    ) <= thick

    basket = in_round_rect(x, y, bx0, by0, bx1, by1, radius)
    wheel_r = box * 0.075
    wheel_y = top + box * 0.82
    left_wheel = (x - (left + box * 0.28)) ** 2 + (y - wheel_y) ** 2 <= wheel_r ** 2
    right_wheel = (x - (left + box * 0.58)) ** 2 + (y - wheel_y) ** 2 <= wheel_r ** 2
    hub = box * 0.032
    left_hub = (x - (left + box * 0.28)) ** 2 + (y - wheel_y) ** 2 <= hub ** 2
    right_hub = (x - (left + box * 0.58)) ** 2 + (y - wheel_y) ** 2 <= hub ** 2

    check = dist_seg(
        x, y,
        left + box * 0.22, top + box * 0.50,
        left + box * 0.36, top + box * 0.62,
    ) <= thick * 0.85 or dist_seg(
        x, y,
        left + box * 0.36, top + box * 0.62,
        left + box * 0.60, top + box * 0.38,
    ) <= thick * 0.85

    if left_hub or right_hub:
        return BG
    if left_wheel or right_wheel or handle:
        return CREAM
    if basket and check:
        return INK
    if basket:
        return CREAM
    return BG


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    write_png(ROOT / "favicon-32.png", 32, 0.06)
    write_png(ROOT / "apple-touch-icon.png", 180, 0.08)
    write_png(ROOT / "icon-192.png", 192, 0.08)
    write_png(ROOT / "icon-512.png", 512, 0.08)
    write_png(ROOT / "icon-maskable.png", 512, 0.18)


if __name__ == "__main__":
    main()
