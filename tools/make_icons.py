#!/usr/bin/env python3
"""Generate favicon.ico and apple-touch-icon.png from the game's palette.

Each size is drawn for that size rather than downscaled from one large image,
so the 16px icon keeps detail meant for 16px instead of turning to mush. The
ICO container is packed by hand because PIL's `sizes=` argument downscales a
single source rather than embedding per-size artwork.

    python3 tools/make_icons.py          # from the repository root
"""

import io
import struct
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("pillow is required: pip install pillow")

HULL_DK = (30, 34, 42)
HULL_MD = (48, 54, 63)
HULL_LT = (70, 78, 90)
RIVET = (115, 125, 140)
CYAN = (79, 208, 232)
CYAN_HI = (180, 244, 255)

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
TOUCH_SIZE = 180


def draw(n: int) -> "Image.Image":
    """A riveted hull plate with the ship over it, drawn at n x n."""
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = n / 32.0

    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=max(2, int(5 * s)), fill=HULL_DK)
    inset = max(1, int(2 * s))
    d.rounded_rectangle(
        [inset, inset, n - 1 - inset, n - 1 - inset],
        radius=max(1, int(3 * s)), fill=HULL_MD,
    )

    # rim girders, top and bottom
    gh = max(1, int(3 * s))
    d.rectangle([inset, inset, n - 1 - inset, inset + gh - 1], fill=HULL_LT)
    d.rectangle([inset, n - 1 - inset - gh + 1, n - 1 - inset, n - 1 - inset], fill=HULL_LT)

    # rivets, but only where they would survive the resolution
    if n >= 24:
        step = max(4, int(6 * s))
        r = max(1, int(1.2 * s))
        for x in range(inset + step // 2, n - inset, step):
            for y in (inset + gh // 2, n - 1 - inset - gh // 2):
                d.ellipse([x - r, y - r, x + r, y + r], fill=RIVET)

    cx, cy = n * 0.52, n * 0.5
    length, height = n * 0.30, n * 0.17
    d.polygon(
        [
            (cx + length, cy),
            (cx - length * 0.35, cy - height),
            (cx - length * 0.7, cy - height * 0.45),
            (cx - length * 0.55, cy),
            (cx - length * 0.7, cy + height * 0.45),
            (cx - length * 0.35, cy + height),
        ],
        fill=CYAN,
    )
    if n >= 24:
        d.polygon(
            [(cx + length * 0.75, cy), (cx - length * 0.2, cy - height * 0.5), (cx - length * 0.4, cy)],
            fill=CYAN_HI,
        )
    return img


def pack_ico(sizes) -> bytes:
    blobs = []
    for n in sizes:
        buf = io.BytesIO()
        draw(n).save(buf, format="PNG", optimize=True)
        blobs.append(buf.getvalue())

    out = io.BytesIO()
    out.write(struct.pack("<HHH", 0, 1, len(sizes)))        # ICONDIR
    offset = 6 + 16 * len(sizes)
    for n, blob in zip(sizes, blobs):
        dim = 0 if n >= 256 else n                           # 256 is encoded as 0
        out.write(struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(blob), offset))
        offset += len(blob)
    for blob in blobs:
        out.write(blob)
    return out.getvalue()


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    ico = pack_ico(ICO_SIZES)
    (root / "favicon.ico").write_bytes(ico)
    draw(TOUCH_SIZE).save(root / "apple-touch-icon.png", optimize=True)
    print(f"favicon.ico        {len(ico):>6} bytes, sizes {ICO_SIZES}")
    print(f"apple-touch-icon.png  {TOUCH_SIZE}x{TOUCH_SIZE}")


if __name__ == "__main__":
    main()
