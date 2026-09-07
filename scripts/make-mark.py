#!/usr/bin/env python3
"""Turn a bar's logo (supplied by hand, not fetched) into an agenda-row
mark that keeps the logo's look, muted: the dark disc stays a soft
charcoal, the gold strokes a desaturated gold, and the lines are
thickened a touch so they survive at ~46px. Pure Python (no PIL). The
site shows these marks unfiltered (.venue-mark), unlike the team crests.

  sips -z 256 256 -s format png logo.png --out /tmp/logo256.png
  python3 scripts/make-mark.py /tmp/logo256.png site/marks/<slug>.png [dilate=1]
"""
import sys, zlib, struct
src, dst = sys.argv[1], sys.argv[2]
R = int(sys.argv[3]) if len(sys.argv) > 3 else 1
data = open(src, 'rb').read()
pos = 8; idat = b''; w = h = 0; ctype = 0
while pos < len(data):
    ln, = struct.unpack('>I', data[pos:pos+4]); typ = data[pos+4:pos+8]; body = data[pos+8:pos+8+ln]
    if typ == b'IHDR': w, h, depth, ctype = struct.unpack('>IIBB', body[:10]); assert depth == 8
    elif typ == b'IDAT': idat += body
    pos += 12 + ln
bpp = {6: 4, 2: 3}[ctype]
raw = zlib.decompress(idat); stride = w * bpp
rows = []; prev = bytearray(stride); p = 0
for y in range(h):
    f = raw[p]; line = bytearray(raw[p+1:p+1+stride]); p += 1 + stride
    for i in range(stride):
        a = line[i-bpp] if i >= bpp else 0; b = prev[i]; c = prev[i-bpp] if i >= bpp else 0
        if f == 1: line[i] = (line[i] + a) & 255
        elif f == 2: line[i] = (line[i] + b) & 255
        elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
        elif f == 4:
            pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
            line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
    rows.append(line); prev = line
# stroke-likeness from luminance: the disc is near-black, the strokes gold
LO, HI = 40, 110
mask = [[0.0] * w for _ in range(h)]
for y, line in enumerate(rows):
    for x in range(w):
        r, g, b = line[x*bpp], line[x*bpp+1], line[x*bpp+2]
        a = line[x*bpp+3] if bpp == 4 else 255
        lum = 0.299*r + 0.587*g + 0.114*b
        mask[y][x] = min(1.0, max(0.0, (lum - LO) / (HI - LO))) * (a / 255.0)
# thicken: each pixel takes the max of its neighbourhood
def dilate(m, r):
    out = [[0.0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            best = 0.0
            for dy in range(-r, r + 1):
                yy = y + dy
                if 0 <= yy < h:
                    row = m[yy]
                    for dx in range(-r, r + 1):
                        xx = x + dx
                        if 0 <= xx < w and row[xx] > best: best = row[xx]
            out[y][x] = best
    return out
mask = dilate(mask, R)
DISC, GOLD = (38, 38, 40), (176, 140, 92)   # charcoal, and the logo's gold pulled toward gray
out = bytearray()
for y in range(h):
    out.append(0)
    line = rows[y]
    for x in range(w):
        k = mask[y][x]
        a = (line[x*bpp+3] if bpp == 4 else 255) / 255.0
        out += bytes((int(DISC[0] + (GOLD[0] - DISC[0]) * k), int(DISC[1] + (GOLD[1] - DISC[1]) * k), int(DISC[2] + (GOLD[2] - DISC[2]) * k),
                      int(round(max(a, k) * 255))))
def chunk(t, b): return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(out), 9)) + chunk(b'IEND', b'')
open(dst, 'wb').write(png); print(f'{dst}: {w}x{h}, dilate {R}, {len(png)} bytes')
