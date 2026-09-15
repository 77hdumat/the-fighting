#!/usr/bin/env python3
"""Deterministic original lighting data; no downloaded imagery or external packages."""
from pathlib import Path
import math
import hashlib
import json

OUT = Path(__file__).resolve().parents[1] / 'assets' / 'rendering'
OUT.mkdir(parents=True, exist_ok=True)
w, h = 512, 256
pixels = bytearray()
for y in range(h):
    theta = math.pi * (y + .5) / h
    up = math.cos(theta)
    for x in range(w):
        phi = 2 * math.pi * (x + .5) / w
        # Ceiling softboxes and cool side fill in an otherwise dark indoor arena.
        ceiling = math.exp(-((theta - .36) / .12) ** 2)
        panels = max(0, math.cos(phi * 4)) ** 24
        side = math.exp(-((theta - 1.22) / .3) ** 2) * max(0, math.cos(phi - 2.4)) ** 12
        floor = max(0, -up) * .12
        rgb = [.055 + floor + ceiling * panels * 14 + side * .35,
               .063 + floor * .91 + ceiling * panels * 12.7 + side * .55,
               .082 + floor * .78 + ceiling * panels * 10.8 + side * 1.05]
        mantissa, exponent = math.frexp(max(rgb))
        scale = mantissa * 256 / max(rgb)
        pixels.extend([*(min(255, int(v * scale)) for v in rgb), exponent + 128])
# Radiance flat RGBE is intentionally portable and lossless; < 1 MB.
(OUT / 'arena-original.hdr').write_bytes(f'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {h} +X {w}\n'.encode() + pixels)
shadow = bytearray()
for y in range(64):
    for x in range(64):
        radius = ((x + .5 - 32) / 32) ** 2 + ((y + .5 - 32) / 32) ** 2
        alpha = int(255 * max(0, math.exp(-radius * 4.5) - math.exp(-4.5)) / (1 - math.exp(-4.5))) if radius < 1 else 0
        shadow.extend((0, 0, 0, alpha))
(OUT / 'contact-shadow.rgba').write_bytes(shadow)
manifest = {'generator': 'scripts/generate_render_assets.py', 'source': 'Original analytic lighting and radial opacity data', 'assets': []}
for name in ['arena-original.hdr', 'contact-shadow.rgba']:
    data = (OUT / name).read_bytes()
    manifest['assets'].append({'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
