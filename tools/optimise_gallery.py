#!/usr/bin/env python3
"""Shrink the README gallery images.

Screenshots come out of the browser at full width and ~450KB each, which is
more than a README needs and more than belongs in a repository. This halves
the dimensions and quantises the palette: the result is still legible at the
width GitHub renders them, at about a third of the bytes.

    python3 tools/optimise_gallery.py
"""

import glob
import os
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("pillow is required: pip install pillow")

MAX_WIDTH = 900
COLOURS = 128
SKIP = ("icon", "apple-touch")

root = Path(__file__).resolve().parent.parent
before = after = 0

for path in sorted(glob.glob(str(root / "docs" / "*.png"))):
    if any(s in os.path.basename(path) for s in SKIP):
        continue
    before += os.path.getsize(path)
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if w > MAX_WIDTH:
        im = im.resize((MAX_WIDTH, round(h * MAX_WIDTH / w)), Image.LANCZOS)
    im.convert("P", palette=Image.ADAPTIVE, colors=COLOURS).save(path, optimize=True)
    after += os.path.getsize(path)

print(f"  gallery {before // 1024}KB -> {after // 1024}KB")
