#!/usr/bin/env python3
"""Mosaic Forge — rebuild one image out of hundreds of your photos.

    python forge.py target.jpg my_photos_folder out.png

The target is divided into a grid; every cell is replaced by the photo from
your library whose colors best match that cell (each photo is compared by a
2x2 color signature, so tiles align with gradients inside the cell, not just
average color). A repeat penalty keeps the same shot from clumping, and an
optional color blend nudges each tile toward the target for long-distance
readability while staying recognizably a photo up close.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image, ImageOps

EXTS = ('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff')


def iter_photos(folder):
    for root, _, files in os.walk(folder):
        for name in files:
            if name.lower().endswith(EXTS):
                yield os.path.join(root, name)


def signature(img):
    """2x2 mean-color signature (Lab-ish weighting via linear RGB), shape (2,2,3)."""
    a = np.asarray(img.resize((16, 16), Image.LANCZOS), dtype=np.float32) / 255.0
    a = a ** 2.2                     # compare in linear light
    return np.stack([
        [a[:8, :8].mean(axis=(0, 1)), a[:8, 8:].mean(axis=(0, 1))],
        [a[8:, :8].mean(axis=(0, 1)), a[8:, 8:].mean(axis=(0, 1))],
    ])


def build_library(folder, tile_px):
    tiles, sigs, names = [], [], []
    paths = list(iter_photos(folder))
    if not paths:
        sys.exit(f'No photos found under {folder}')
    print(f'Indexing {len(paths)} photos…')
    for i, path in enumerate(paths):
        try:
            with Image.open(path) as im:
                im = ImageOps.exif_transpose(im).convert('RGB')
                im = ImageOps.fit(im, (tile_px, tile_px), Image.LANCZOS)
        except Exception as e:
            print(f'  skip {os.path.basename(path)}: {e}')
            continue
        tiles.append(im)
        sigs.append(signature(im))
        names.append(os.path.basename(path))
        if (i + 1) % 100 == 0:
            print(f'  {i + 1}/{len(paths)}')
    if len(tiles) < 16:
        sys.exit(f'Only {len(tiles)} usable photos — need at least 16 for a decent mosaic.')
    return tiles, np.stack(sigs), names


def build_mosaic(target_path, folder, out_path, grid_w=72, tile_px=96,
                 blend=0.30, repeat_radius=3):
    tiles, sigs, names = build_library(folder, tile_px)
    n = len(tiles)

    with Image.open(target_path) as t:
        target = ImageOps.exif_transpose(t).convert('RGB')
    grid_h = max(8, round(grid_w * target.height / target.width))
    print(f'Grid {grid_w}x{grid_h} = {grid_w * grid_h} cells from {n} photos '
          f'-> {grid_w * tile_px}x{grid_h * tile_px}px output')

    # per-cell 2x2 signatures of the target
    small = target.resize((grid_w * 2, grid_h * 2), Image.LANCZOS)
    sa = (np.asarray(small, dtype=np.float32) / 255.0) ** 2.2
    cell_sigs = np.zeros((grid_h, grid_w, 2, 2, 3), dtype=np.float32)
    for sy in range(2):
        for sx in range(2):
            cell_sigs[:, :, sy, sx] = sa[sy::2, sx::2]

    flat_sigs = sigs.reshape(n, -1)                       # (n, 12)
    out = Image.new('RGB', (grid_w * tile_px, grid_h * tile_px))
    chosen = -np.ones((grid_h, grid_w), dtype=int)
    usage = np.zeros(n, dtype=np.float32)

    for gy in range(grid_h):
        for gx in range(grid_w):
            want = cell_sigs[gy, gx].reshape(-1)
            d = ((flat_sigs - want) ** 2).sum(axis=1)
            # de-clump: forbid the exact tile within the repeat radius,
            # and softly penalize globally-overused tiles
            for dy in range(-repeat_radius, repeat_radius + 1):
                for dx in range(-repeat_radius, repeat_radius + 1):
                    yy, xx = gy + dy, gx + dx
                    if 0 <= yy < grid_h and 0 <= xx < grid_w and chosen[yy, xx] >= 0:
                        d[chosen[yy, xx]] = np.inf
            d += usage * 0.008
            pick = int(np.argmin(d))
            chosen[gy, gx] = pick
            usage[pick] += 1

            tile = tiles[pick]
            if blend > 0:
                mean = (cell_sigs[gy, gx].mean(axis=(0, 1)) ** (1 / 2.2) * 255).astype(np.uint8)
                overlay = Image.new('RGB', tile.size, tuple(int(v) for v in mean))
                tile = Image.blend(tile, overlay, blend)
            out.paste(tile, (gx * tile_px, gy * tile_px))
        if (gy + 1) % 10 == 0:
            print(f'  row {gy + 1}/{grid_h}')

    out.save(out_path, quality=92)
    used = int((usage > 0).sum())
    print(f'Done: {out_path} — {used}/{n} photos used, '
          f'busiest photo appears {int(usage.max())}x ({names[int(usage.argmax())]})')
    return out_path


def main():
    ap = argparse.ArgumentParser(description='Rebuild an image out of your photo library.')
    ap.add_argument('target', help='the image to recreate (logo, favorite shot)')
    ap.add_argument('photos', help='folder of photos to build with (searched recursively)')
    ap.add_argument('out', nargs='?', default='mosaic.png')
    ap.add_argument('--grid', type=int, default=72, help='tiles across (default 72)')
    ap.add_argument('--tile', type=int, default=96, help='pixels per tile (default 96)')
    ap.add_argument('--blend', type=float, default=0.30,
                    help='0..1 color nudge toward the target (default 0.30; 0 = pure photos)')
    ap.add_argument('--spread', type=int, default=3,
                    help='min distance before a photo may repeat (default 3)')
    args = ap.parse_args()
    build_mosaic(args.target, args.photos, args.out,
                 grid_w=args.grid, tile_px=args.tile,
                 blend=args.blend, repeat_radius=args.spread)


if __name__ == '__main__':
    main()
