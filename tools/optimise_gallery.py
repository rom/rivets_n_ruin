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
    from PIL import Image, ImageChops
except ImportError:
    sys.exit("pillow is required: pip install pillow")

MAX_WIDTH = 900
COLOURS = 160
SKIP = ("icon", "apple-touch")

# MEDIANCUT - Pillow's default for ADAPTIVE - allocates palette entries by
# how many pixels sit near them. These screenshots are 95% dark hull, so the
# few hundred pixels of treasure, boss trim and HUD accent were merged into
# grey: the gallery had been losing its colour since it was written, and the
# treasure sheet came out as four identical teal blobs. MAXCOVERAGE keeps
# the outliers, and here it is also five times smaller.
METHOD = Image.MAXCOVERAGE

# How much of an image's most saturated pixel may be lost to quantisation.
# This is the check that would have caught the above.
MIN_SATURATION_KEPT = 0.75

def peak_saturation(im):
    """The most saturated pixel in the image, 0..255."""
    r, g, b = im.convert("RGB").split()
    hi = ImageChops.lighter(ImageChops.lighter(r, g), b)
    lo = ImageChops.darker(ImageChops.darker(r, g), b)
    return ImageChops.subtract(hi, lo).getextrema()[1]


root = Path(__file__).resolve().parent.parent
before = after = 0
failures = []

for path in sorted(glob.glob(str(root / "docs" / "*.png"))):
    if any(s in os.path.basename(path) for s in SKIP):
        continue
    before += os.path.getsize(path)
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if w > MAX_WIDTH:
        im = im.resize((MAX_WIDTH, round(h * MAX_WIDTH / w)), Image.LANCZOS)
    was = peak_saturation(im)
    q = im.quantize(colors=COLOURS, method=METHOD, dither=Image.FLOYDSTEINBERG)
    now = peak_saturation(q)
    if was > 40 and now < was * MIN_SATURATION_KEPT:
        failures.append(f"{os.path.basename(path)}: peak saturation {was} -> {now}")
    q.save(path, optimize=True)
    after += os.path.getsize(path)

print(f"  gallery {before // 1024}KB -> {after // 1024}KB")
if failures:
    print()
    print("  quantisation is eating the colour out of these:")
    for f in failures:
        print("   ", f)
    sys.exit("  raise COLOURS, or change METHOD")
