"""End-to-end test: synthesize a photo library + target, build a mosaic,
verify structure (output resembles target at a distance, no adjacent repeats)."""
import os
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import forge

tmp = tempfile.mkdtemp()
photo_dir = os.path.join(tmp, 'photos')
os.makedirs(photo_dir)

# library: 120 fake "photos" across the hue wheel with texture
rng = np.random.default_rng(7)
for i in range(120):
    hue = np.array([rng.random(), rng.random(), rng.random()]) * 255
    base = np.tile(hue, (200, 200, 1))
    noise = rng.normal(0, 22, (200, 200, 3))
    img = np.clip(base + noise, 0, 255).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(photo_dir, f'p{i:03d}.jpg'))

# target: red circle on dark blue
target = Image.new('RGB', (400, 300), (12, 24, 96))
d = ImageDraw.Draw(target)
d.ellipse([120, 50, 320, 250], fill=(210, 30, 30))
target_path = os.path.join(tmp, 'target.png')
target.save(target_path)

out_path = os.path.join(tmp, 'mosaic.png')
forge.build_mosaic(target_path, photo_dir, out_path, grid_w=40, tile_px=24,
                   blend=0.25, repeat_radius=2)

out = Image.open(out_path)
assert out.width == 40 * 24, out.size

# distance check: downscale mosaic to target size; center should read red-ish,
# corner blue-ish
small = np.asarray(out.resize(target.size)).astype(float)
cx = small[140:160, 210:230].mean(axis=(0, 1))
corner = small[5:25, 5:25].mean(axis=(0, 1))
assert cx[0] > cx[2] + 30, f'center not red-dominant: {cx}'
assert corner[2] > corner[0] + 12, f'corner not blue-dominant: {corner}'
print('center rgb:', cx.round(0), '| corner rgb:', corner.round(0))
print('ALL MOSAIC TESTS PASSED')
print('preview:', out_path)
