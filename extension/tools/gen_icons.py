#!/usr/bin/env python3
"""生成 markmax 插件图标：黑色圆角矩形 + 白色 M。纯标准库（struct/zlib），3x3 超采样抗锯齿。"""
import struct
import zlib
from pathlib import Path

SIZES = [16, 32, 48, 128]
OUT = Path(__file__).resolve().parent / ".." / "icons"


def dist_seg(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    """点到线段的距离。"""
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    if l2 == 0:
        return ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def in_rounded(px: float, py: float, n: int) -> bool:
    """黑色圆角矩形（radius = 0.22n）。"""
    r = 0.22 * n
    x = min(max(px, r), n - r)
    y = min(max(py, r), n - r)
    return (px - x) ** 2 + (py - y) ** 2 <= r * r


def in_m(px: float, py: float, n: int) -> bool:
    """白色 M：两条竖笔 + 两条斜笔画。"""
    top, bot = 0.26 * n, 0.74 * n
    xl, xr = 0.22 * n, 0.78 * n
    hw = 0.055 * n
    mx, my = 0.5 * n, 0.60 * n
    if py < top or py > bot:
        return False
    return (
        min(
            dist_seg(px, py, xl, top, xl, bot),
            dist_seg(px, py, xr, top, xr, bot),
            dist_seg(px, py, xl, top, mx, my),
            dist_seg(px, py, xr, top, mx, my),
        )
        <= hw
    )


def make_png(size: int, path: Path) -> None:
    ss = 3  # 3x3 超采样
    rows = []
    for y in range(size):
        row = b"\x00"  # filter type 0
        for x in range(size):
            rect_cnt = m_cnt = 0
            for sy in range(ss):
                for sx in range(ss):
                    px = x + (sx + 0.5) / ss
                    py = y + (sy + 0.5) / ss
                    if not in_rounded(px, py, size):
                        continue
                    rect_cnt += 1
                    if in_m(px, py, size):
                        m_cnt += 1
            total = ss * ss
            white = round(255 * m_cnt / total)
            alpha = round(255 * rect_cnt / total)
            row += bytes([white, white, white, alpha])
        rows.append(row)
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    print(f"  {path.name} ({size}x{size})")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        make_png(size, OUT / f"icon{size}.png")


if __name__ == "__main__":
    main()
