#!/usr/bin/env python3
"""Draw the home-screen icon: a cream apple on a terracotta square."""

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "icons"

BG = (157, 61, 22, 255)
APPLE = (244, 239, 228, 255)
LEAF = (31, 107, 69, 255)
STEM = (92, 48, 28, 255)


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int) -> None:
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x + 0.5, y + 0.5, size))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def pixel(x: float, y: float, size: int) -> tuple[int, int, int, int]:
    cx = size * 0.50
    cy = size * 0.56
    radius = size * 0.30
    dx = x - cx
    dy = (y - cy) / 0.92
    apple = dx * dx + dy * dy <= radius * radius

    # A small bite taken from the right, so it reads as an apple at a glance.
    bite = (x - (cx + radius * 0.72)) ** 2 + (y - (cy + radius * 0.05)) ** 2 <= (radius * 0.38) ** 2

    stem_x = abs(x - cx) <= size * 0.025
    stem_y = (cy - radius * 0.95) <= y <= (cy - radius * 0.55)
    leaf_dx = (x - (cx + size * 0.08)) / (size * 0.11)
    leaf_dy = (y - (cy - radius * 0.82)) / (size * 0.055)
    leaf = leaf_dx * leaf_dx + leaf_dy * leaf_dy <= 1 and x >= cx

    if leaf:
        return LEAF
    if stem_x and stem_y:
        return STEM
    if apple and not bite:
        return APPLE
    return BG


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    for name, size in (
        ("favicon-32.png", 32),
        ("apple-touch-icon.png", 180),
        ("icon-192.png", 192),
        ("icon-512.png", 512),
    ):
        write_png(ROOT / name, size)


if __name__ == "__main__":
    main()
