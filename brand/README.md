# brand/ – Quellen der Marke MIND//SHAPES

Hier liegen die Quellen für Zeichen und Wortmarke. Alles, was im Spiel, im Vorschaubild
und in den Icon-Dateien erscheint, wird aus diesen SVGs erzeugt. Korrekturen gehören in
die SVGs, danach wird neu gebaut (siehe unten).

| Datei | Inhalt | Verwendung |
|---|---|---|
| `icon.svg` | Zeichen, voller Schnitt: Rahmen mit Lücken, zwei Striche, dezenter Glow | `apple-touch-icon.png`, `og-v1.png`, Ergebnisbild im Spiel (Path2D) |
| `icon-small.svg` | Zeichen, kleiner Schnitt: nur die Striche, kräftiger, ohne Glow | Favicon als SVG-Data-URI in `index.html`, `favicon.ico` |
| `wordmark.svg` | Wortmarke MIND//SHAPES als Pfade | Menükopf (inline-SVG), Ergebnisbild (Path2D), `og-v1.png` |
| `wordmark.py` | erzeugt `wordmark.svg` aus der Schrift | nur bei Änderung der Wortmarke |
| `build.py` | erzeugt die PNGs und `favicon.ico`, synchronisiert `index.html` | nach jeder Änderung an den SVGs |

Geometrie, die in allen drei SVGs gleich ist: Neigung der Striche dx/dy = 0,36, Mittenabstand
der beiden Striche 12 Einheiten im 64er-Raster des Icons (in der Wortmarke proportional,
12/46 der Strichhöhe). Farben: Navy `#0c1222`, Cyan `#3ddcff`, Text `#e9eefb`.

## Schrift der Wortmarke

- **Schrift:** TeX Gyre Adventor, Schnitt **Bold**, Version 2.501 (OTF-Namenstabelle:
  „Version 2.501;PS 2.501;ffdkm 0.1“), Copyright 2007–2018 B. Jackowski, J.M. Nowacki
  et al. im Auftrag der TeX User Groups (GUST). Bezug: CTAN, Paket `tex-gyre`;
  verwendete Datei `texgyreadventor-bold.otf` aus Fedora-Paket `texlive-tex-gyre` svn68624.
- **Im og-Bild** ist der Claim in TeX Gyre Adventor Regular gesetzt (gleiche Version).
  Im Spiel selbst bleiben Claim, Fließtext und Oberfläche beim System-Schriftstapel.
- **Lizenz:** GUST Font License (GFL), die die LaTeX Project Public License 1.3c
  einschließt. Fundstellen: `/usr/share/licenses/texlive-tex-gyre/lppl1.3c.txt` auf dem
  Build-Rechner, auf CTAN unter `fonts/tex-gyre/doc/fonts/tex-gyre/` sowie
  <https://www.gust.org.pl/projects/e-foundry/licenses>. Die GFL regelt Weitergabe und
  Änderung der Font-Dateien (geänderte Fonts müssen umbenannt werden) und legt kein
  Copyleft auf Dokumente oder Grafiken, die mit der Schrift erzeugt werden. Die
  Wortmarke enthält keine Font-Datei, nur Umrisse der zehn Großbuchstaben als Pfade.
- **Warum nicht URW Gothic:** TeX Gyre Adventor ist die GUST-Abwandlung von URW Gothic L,
  die Zeichnung ist dieselbe. Die URW-Base35-Dateien (z. B. `URWGothic-Demi.otf`, Paket
  `urw-base35-fonts` 20200910) stehen aber unter **AGPLv3**; die einzige Ausnahme in deren
  `LICENSE` erlaubt nur das Einbetten der Fontprogramme in PostScript- oder PDF-Dokumente.
  Umrisse als SVG-Pfade in einem Logo sind davon nicht gedeckt. **Deshalb bewusst nicht
  auf URW Gothic zurückwechseln**, auch wenn `wordmark.py` technisch jede OTF/TTF nimmt.

## Neu erzeugen

Voraussetzungen: Python 3, `rsvg-convert` (librsvg). Für `favicon.ico` ImageMagick
(`magick`); fehlt es, schreibt `build.py` eine ICO mit PNG-Einträgen. Für `wordmark.py`
zusätzlich `fontTools` (`pip install fonttools`) und die Schrift TeX Gyre Adventor Bold.

```sh
# 1. nur bei Änderung der Wortmarke: Pfade neu aus der Schrift erzeugen
python3 brand/wordmark.py /usr/share/fonts/tex-gyre/texgyreadventor-bold.otf

# 2. PNGs, favicon.ico und die eingebetteten Kopien in index.html
python3 brand/build.py            # schreibt apple-touch-icon.png, og-v1.png, favicon.ico
python3 brand/build.py --no-sync  # dasselbe, ohne index.html anzufassen
```

`build.py` ersetzt in `index.html` genau zwei Zeilen: den `<link rel="icon" …data:…>` mit dem
Favicon und die Zeile `const BRAND={…};` mit den Pfaddaten für Menükopf und Ergebnisbild.
Beide Zeilen nie von Hand pflegen.

Wird `og-v1.png` sichtbar geändert, die Nummer im Dateinamen und in den `og:image`-Tags
hochzählen (`og-v2.png`), weil Messenger Vorschauen lange zwischenspeichern.
