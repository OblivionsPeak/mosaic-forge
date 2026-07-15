# Mosaic Forge

Rebuild one image out of hundreds of your photos.

Point it at a target image (a logo, a favorite shot) and a folder of photos —
it recreates the target as a giant mosaic where every tile is one of your
actual pictures. Reads like the target from across the room; reads like your
photography up close. Built for poster prints and season retrospectives.

```bat
pip install pillow numpy
python forge.py opmo-logo.png "D:\Photos\2026 season" poster.png
```

## Knobs

| Flag | Default | What it does |
|---|---|---|
| `--grid 72` | 72 | tiles across — more = finer likeness, smaller tiles |
| `--tile 96` | 96 | pixels per tile — 96 @ grid 72 ≈ 7000px wide (print quality) |
| `--blend 0.30` | 0.30 | color nudge toward the target; 0 = untouched photos, 0.5 = poster-graphic look |
| `--spread 3` | 3 | minimum distance before the same photo may appear again |

Matching uses a 2×2 color signature per tile in linear light, so photos are
placed to follow gradients *inside* each cell — edges and lettering stay
crisp. A global usage penalty keeps any one photo from dominating.

Tips:
- 300+ photos makes a clearly better mosaic than 100; variety of color matters
  more than count past ~500.
- High-contrast targets with big shapes (logos, helmets, cars on plain
  backgrounds) work best.
- For printing: `--grid 100 --tile 128` produces a ~12800px-wide file — at
  150 dpi that's a 2-meter banner.

## Test

```bat
python tests\test_forge.py
```
Synthesizes a color-noise photo library, rebuilds a known shape, and checks
the result reads correctly at a distance.
