#!/usr/bin/env python3
"""Erzeugt brand/wordmark.svg: die Wortmarke MIND//SHAPES als Pfade.

Buchstaben: TeX Gyre Adventor Bold (GUST Font License), Umrisse einmalig in Pfade
gewandelt, damit die Marke auf jedem Gerät gleich aussieht. Die beiden Schrägstriche
sind keine Glyphen, sondern dieselbe Geometrie wie in icon.svg (Neigung dx/dy = 0.36,
Cyan, dünner als die Buchstaben). Sperrung wie im Spiel (.12em).

Aufruf:  python3 brand/wordmark.py [pfad/zur/schrift.otf]
Braucht fontTools (pip install fonttools). Nur nötig, wenn sich die Wortmarke ändert;
brand/build.py liest die fertige wordmark.svg.
"""
import sys, os, re
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/tex-gyre/texgyreadventor-bold.otf'
K = 0.36            # Neigung der Schrägstriche, wie icon.svg
TRACK = 0.12        # Sperrung in em, wie .brand im Spiel
GAP_L, GAP_R = 0.02, 0.08   # Luft vor und nach dem Doppelstrich (em), wie .brand span margin
SLASH_W = 0.072     # Strichbreite in em, deutlich dünner als die Buchstabenstämme
CYAN, TXT = '#3ddcff', '#e9eefb'

f = TTFont(FONT)
upm = f['head'].unitsPerEm
gs = f.getGlyphSet(); cmap = f.getBestCmap(); hmtx = f['hmtx']
cap = f['OS/2'].sCapHeight if hasattr(f['OS/2'], 'sCapHeight') and f['OS/2'].sCapHeight else int(upm*0.72)
em = lambda v: v*upm

def word(text, x):
    """Pfaddaten für text ab x (Font-Einheiten, y nach unten), gibt (d, x_ende_ohne_Sperrung)."""
    d = []
    for i, ch in enumerate(text):
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=lambda v: f'{v:.0f}')
        gs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))   # y spiegeln: SVG wächst nach unten
        d.append(pen.getCommands())
        x += hmtx[g][0] + (em(TRACK) if i < len(text)-1 else 0)
    return ' '.join(d), x

x = 0
d1, x = word('MIND', x)
x += em(TRACK) + em(GAP_L)
# Schrägstriche: Höhe = Versalhöhe plus etwas Überstand, Abstand wie im Icon (12/46 der Strichhöhe)
h = cap*1.10; y0, y1 = -cap*1.05, cap*0.05
dx = K*h/2; sp = h*12/46; w = em(SLASH_W)
cx1 = x + dx + w/2; cx2 = cx1 + sp
slashes = f'M{cx1-dx:.0f} {y1:.0f}L{cx1+dx:.0f} {y0:.0f} M{cx2-dx:.0f} {y1:.0f}L{cx2+dx:.0f} {y0:.0f}'
x = cx2 + dx + w/2 + em(GAP_R) + em(TRACK)
d2, x = word('SHAPES', x)
W = x; top = -cap*1.05 - w; bottom = cap*0.05 + w
H = bottom - top
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {top:.0f} {W:.0f} {H:.0f}" width="{W/upm*100:.1f}" height="{H/upm*100:.1f}" role="img" aria-label="MIND//SHAPES">
  <!-- MIND//SHAPES · Wortmarke als Pfade. Erzeugt von brand/wordmark.py aus {os.path.basename(FONT)}; Einheiten: 1 em = {upm}. -->
  <path id="letters" fill="{TXT}" d="{d1} {d2}"/>
  <path id="slashes" fill="none" stroke="{CYAN}" stroke-width="{w:.0f}" stroke-linecap="round" d="{slashes}"/>
</svg>
'''
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'wordmark.svg')
open(out, 'w').write(svg)
print(f'{out}: {W:.0f} x {H:.0f} Einheiten (em {upm}, Versalhöhe {cap}), {len(svg)} Bytes')
