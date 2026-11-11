#!/usr/bin/env python3
"""Erzeugt aus den SVG-Quellen in brand/ die Dateien, die Betriebssysteme und Crawler brauchen,
und synchronisiert die eingebetteten Kopien in index.html.

  brand/icon.svg        voller Schnitt (Rahmen + Striche)  -> apple-touch-icon.png, og-v1.png, Ergebnisbild (Path2D)
  brand/icon-small.svg  kleiner Schnitt (nur Striche)     -> Favicon als SVG-Data-URI in index.html, favicon.ico (16 + 32 px)
  brand/wordmark.svg    Wortmarke als Pfade                -> og-v1.png, Menükopf und Ergebnisbild (Path2D)

Aufruf:  python3 brand/build.py            schreibt apple-touch-icon.png, og-v1.png und favicon.ico, aktualisiert index.html
         python3 brand/build.py --no-sync  nur die PNGs
Braucht rsvg-convert (librsvg); für favicon.ico ImageMagick (magick), ersatzweise wird eine ICO mit PNG-Einträgen geschrieben. Für den Claim im og-Bild wird die Schrift "TeX Gyre Adventor" verwendet,
die bei der Erzeugung installiert sein muss (Fallback: fontconfig wählt eine andere Sans).
"""
import os, re, shutil, struct, subprocess, sys, tempfile
from urllib.parse import quote

BR = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(BR)
NAVY = '#0c1222'; OG_VERSION = 'og-v1.png'
CLAIM_FONT = 'TeX Gyre Adventor'

def read(name): return open(os.path.join(BR, name), encoding='utf-8').read()
def rsvg(svg, out, w=None, h=None):
    with tempfile.NamedTemporaryFile('w', suffix='.svg', delete=False, encoding='utf-8') as t: t.write(svg); tmp = t.name
    try:
        a = ['rsvg-convert', tmp, '-o', out]
        if w: a += ['-w', str(w)]
        if h: a += ['-h', str(h)]
        subprocess.run(a, check=True)
    finally: os.unlink(tmp)
def attr(svg, elem_id, name):
    m = re.search(r'<[a-z]+[^>]*\bid="%s"[^>]*>' % re.escape(elem_id), svg)
    if not m: raise SystemExit(f'Element #{elem_id} fehlt')
    v = re.search(r'\b%s="([^"]*)"' % name, m.group(0))
    return v.group(1) if v else None
def strip_bg(svg):
    """Innerer Inhalt von icon.svg ohne Hintergrundkachel (für og-Bild und Canvas)."""
    body = re.sub(r'<rect id="bg"[^>]*/>', '', svg)
    body = re.sub(r'<\?xml[^>]*>|<!--.*?-->', '', body, flags=re.S)
    return re.search(r'<svg[^>]*>(.*)</svg>', body, re.S).group(1)

icon, small, wm = read('icon.svg'), read('icon-small.svg'), read('wordmark.svg')

# --- apple-touch-icon.png: 180 x 180, deckender Navy-Grund ohne gerundete Ecken (iOS maskiert selbst)
rsvg(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="{NAVY}"/>{strip_bg(icon)}</svg>',
     os.path.join(ROOT, 'apple-touch-icon.png'), 180, 180)

# --- og-v1.png: 1200 x 630, das Wesentliche in der mittleren 630er-Fläche (x 285..915)
vb = [float(v) for v in attr(wm, 'letters', 'd') and re.search(r'viewBox="([^"]*)"', wm).group(1).split()]
wm_w, wm_h, wm_top = vb[2], vb[3], vb[1]
cap = 52.0; s_wm = cap / 739.0                       # Versalhöhe der Wortmarke im Bild (px) -> Maßstab (739 = Versalhöhe der Schrift)
wm_x = 600 - wm_w * s_wm / 2; wm_base = 430
s_ic = 4.6; ic_x = 600 - 32 * s_ic; ic_y = 100 - 9 * s_ic   # sichtbarer Inhalt (y 9..55 im 64er-Raster) auf ~210 px, ein Drittel der Bildhöhe
og = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
 <radialGradient id="g1" cx="0.1" cy="-0.1" r="0.8"><stop offset="0" stop-color="#3ddcff" stop-opacity=".17"/><stop offset="1" stop-color="#3ddcff" stop-opacity="0"/></radialGradient>
 <radialGradient id="g2" cx="1" cy="1.1" r="0.7"><stop offset="0" stop-color="#a593ff" stop-opacity=".16"/><stop offset="1" stop-color="#a593ff" stop-opacity="0"/></radialGradient>
 <pattern id="grid" width="72" height="72" patternUnits="userSpaceOnUse"><path d="M72 0H0V72" fill="none" stroke="#232f4d"/></pattern>
 <radialGradient id="gm" cx=".5" cy=".4" r=".6"><stop offset=".1" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
 <mask id="m"><rect width="1200" height="630" fill="url(#gm)"/></mask>
</defs>
<rect width="1200" height="630" fill="{NAVY}"/>
<rect width="1200" height="630" fill="url(#g1)"/><rect width="1200" height="630" fill="url(#g2)"/>
<rect width="1200" height="630" fill="url(#grid)" opacity=".32" mask="url(#m)"/>
<g transform="translate({ic_x:.1f} {ic_y:.1f}) scale({s_ic})">{strip_bg(icon)}</g>
<g transform="translate({wm_x:.1f} {wm_base}) scale({s_wm:.5f})">{strip_bg(wm)}</g>
<text x="600" y="492" text-anchor="middle" font-family="{CLAIM_FONT}" font-size="27" letter-spacing="1.4" fill="#93a0bf">Think beyond the obvious.</text>
</svg>'''
rsvg(og, os.path.join(ROOT, OG_VERSION))
# --- favicon.ico: kleiner Schnitt in 16 und 32 px, für Browser ohne SVG-Favicon (Safari)
ico = os.path.join(ROOT, 'favicon.ico'); pngs = []
for sz in (16, 32):
    pth = os.path.join(tempfile.gettempdir(), f'mindshapes-favicon-{sz}.png'); rsvg(small, pth, sz, sz); pngs.append(pth)
if shutil.which('magick'):
    subprocess.run(['magick', *pngs, ico], check=True)
else:   # ICO mit PNG-Einträgen (seit Windows Vista und in allen aktuellen Browsern gültig)
    data = [open(p_, 'rb').read() for p_ in pngs]; off = 6 + 16 * len(data); out = struct.pack('<HHH', 0, 1, len(data))
    for sz, d in zip((16, 32), data): out += struct.pack('<BBBBHHII', sz, sz, 0, 0, 1, 32, len(d), off); off += len(d)
    open(ico, 'wb').write(out + b''.join(data))
for p_ in pngs: os.unlink(p_)
for f in ('apple-touch-icon.png', OG_VERSION, 'favicon.ico'):
    print(f'{f}: {os.path.getsize(os.path.join(ROOT, f))} Bytes')

# --- Favicon als Data-URI (kleiner Schnitt, minimiert) und Pfaddaten für index.html
mini = re.sub(r'<!--.*?-->', '', small, flags=re.S)
mini = re.sub(r'\s+', ' ', mini).replace('> <', '><').replace('"', "'").strip()
mini = re.sub(r" width='64' height='64'", '', mini, count=1)
favicon = 'data:image/svg+xml,' + quote(mini, safe=" -_.~:/=,;'()")
brand = ("const BRAND={vb:'%s',letters:'%s',slashes:'%s',sw:%s,icon:{frame:'%s',slashes:'%s',fw:%s,sw:%s}};" % (
    re.search(r'viewBox="([^"]*)"', wm).group(1), attr(wm, 'letters', 'd'), attr(wm, 'slashes', 'd'), attr(wm, 'slashes', 'stroke-width'),
    attr(icon, 'frame', 'd'), attr(icon, 'slashes', 'd'), attr(icon, 'frame', 'stroke-width'), attr(icon, 'slashes', 'stroke-width')))
print(f'Favicon-Data-URI: {len(favicon)} Zeichen; BRAND: {len(brand)} Zeichen')

if '--no-sync' not in sys.argv:
    p = os.path.join(ROOT, 'index.html'); html = open(p, encoding='utf-8').read(); n = 0
    html, k = re.subn(r'<link rel="icon" type="image/svg\+xml" sizes="any" href="data:image/svg\+xml,[^"]*">',
                      '<link rel="icon" type="image/svg+xml" sizes="any" href="%s">' % favicon, html); n += k
    html, k = re.subn(r'^const BRAND=\{.*\};$', lambda m: brand, html, flags=re.M); n += k
    if n != 2: raise SystemExit(f'index.html: erwartet 2 Stellen zum Synchronisieren, gefunden {n}')
    open(p, 'w', encoding='utf-8').write(html); print('index.html: Favicon und BRAND synchronisiert')
