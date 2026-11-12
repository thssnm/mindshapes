#!/usr/bin/env node
/* MIND//SHAPES – Browsertest der Endless-Läufe (Desktop 1280 px und Telefon 390 px)
   Braucht playwright-core und einen Chromium; beides ist nicht Teil des Spiels.
     NODE_PATH=<ordner mit node_modules> CHROME=<pfad zu chrome> node test/endless.mjs [--shots <ordner>] */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NODE_PATH ? join(process.env.NODE_PATH, 'playwright-core') : 'playwright-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), URL = 'file://' + join(ROOT, 'index.html');
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const a = html.indexOf("'use strict';"), b = html.indexOf('/* =====================================================================\n   UI');
const E = new Function(html.slice(a + 13, b) + '\nreturn {generate};')();
const results = [];
const ok = (name, cond, info = '') => results.push({ name, ok: !!cond, info });

async function puzzle(page) { const g = page.locator('.game'); return E.generate(await g.getAttribute('data-seed'), await g.getAttribute('data-type'), +(await g.getAttribute('data-d'))); }
async function click(page, sel) { await page.locator(sel).first().click(); }
async function enter(page, p, ans) {                       // Antwort über die Oberfläche eingeben
  const v = p.view;
  switch (p.kind) {
    case 'number': for (const ch of String(ans)) await click(page, `.key[data-k="${ch === '-' ? '±' : ch}"]`); break;
    case 'choice': await click(page, `.opt[data-i="${ans}"]`); break;
    case 'net': await click(page, `.face[data-i="${ans}"]`); break;
    case 'sym': for (const i of ans) await click(page, `rect.c[data-i="${i}"]`); break;
    case 'paint': for (let m = 0; m < ans.length; m++) for (let k = 0; k <= ans[m]; k++) await click(page, `.pcell.hole[data-m="${m}"]`); break;
    case 'equation': for (const t of ans) { const tiles = page.locator(typeof t === 'number' ? '.tile.tn' : '.tile.to'), n = await tiles.count();
        for (let i = 0; i < n; i++) { const el = tiles.nth(i); if ((await el.textContent()) === String(t) && !(await el.isDisabled())) { await el.click(); break; } } } break;
    case 'logic': for (let i = 0; i < v.N; i++) { for (let k = 0; k <= ans.s[i]; k++) await click(page, `.lbtn[data-f="${i}"]`); if (v.cats === 2) for (let k = 0; k <= ans.c[i]; k++) await click(page, `.lcol[data-c="${i}"]`); } break;
    case 'assemble': for (let i = 0; i < v.pieces.length; i++) {
        const sol = v.pieces[i].sol, norm = c => { const mx = Math.min(...c.map(q => q[0])), my = Math.min(...c.map(q => q[1])); return c.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]).join(';'); };
        const piece = page.locator('.piece').nth(i); await piece.focus(); let cells = v.pieces[i].cells.map(c => c.slice());
        for (let r = 0; r < 4 && norm(cells) !== norm(sol); r++) { const d1 = Math.max(...cells.map(c => c[1])) + 1; cells = cells.map(([x, y]) => [d1 - 1 - y, x]); await page.keyboard.press(' '); }
        const [, px, py] = (await piece.getAttribute('transform')).match(/translate\(([-\d.]+),([-\d.]+)\)/).map(Number);
        let x = Math.round(px / 40), y = Math.round(py / 40); const tx = Math.min(...sol.map(q => q[0])), ty = Math.min(...sol.map(q => q[1]));
        while (y > ty) { await page.keyboard.press('ArrowUp'); y--; } while (y < ty) { await page.keyboard.press('ArrowDown'); y++; }
        while (x > tx) { await page.keyboard.press('ArrowLeft'); x--; } while (x < tx) { await page.keyboard.press('ArrowRight'); x++; } } break;
  }
}
async function solve(page) { const p = await puzzle(page); await click(page, '[data-act="restart"]'); await enter(page, p, p.solution); await click(page, '[data-act="check"]'); await page.locator('#result:not([hidden])').waitFor({ timeout: 3000 }); return p; }
async function wrong(page) {                                // Level 1 des ersten Laufs ist immer Number Logic mit Zahleneingabe
  const p = await puzzle(page); if (p.kind !== 'number') throw new Error('erwartet Zahleneingabe, nicht ' + p.kind);
  await enter(page, p, p.solution + 1); await click(page, '[data-act="check"]'); return p;
}
const lives = page => page.locator('#rlives .lives polygon.on').count();
const msg = page => page.locator('#msg').textContent();
const shot = async (page, name, w) => { if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: join(SHOTS, `${name}-${w}.png`), fullPage: name !== 'kopf' }); } };

const browser = await chromium.launch({ executablePath: process.env.CHROME });
for (const width of [390, 1280]) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1, hasTouch: width === 390 });
  const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)));
  const W = '@' + width, fresh = async () => { await page.goto(URL); await page.evaluate(() => localStorage.clear()); await page.goto(URL); };
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

  // 1  Neuer Spieler: Regeln, Kopf, drei Fehler beenden den Lauf
  await fresh(); await shot(page, 'menu-neu', width);
  await click(page, '[data-act="endless"]');
  ok('Regeln beim ersten Lauf' + W, await page.locator('.rulesintro').count());
  ok('drei Leben im Kopf' + W, (await lives(page)) === 3);
  const box = async s => (await page.locator(s).boundingBox()) || {};
  const tb = await box('#timer'); ok('Zeit nicht verdrängt' + W, tb.width > 40 && tb.x + tb.width <= width, JSON.stringify(tb));
  ok('kein waagerechtes Scrollen' + W, await noScroll());
  await shot(page, 'kopf', width);
  const first = await wrong(page);
  ok('Meldung nach Fehler' + W, /Falsch\. Ein Leben weniger, noch 2\./.test(await msg(page)), await msg(page));
  ok('zwei Leben nach Fehler' + W, (await lives(page)) === 2);
  await shot(page, 'fehler', width);
  await page.reload(); await click(page, '[data-act="endless"]');
  ok('Leben bleibt nach Neuladen weg' + W, (await lives(page)) === 2);
  ok('nach Neuladen dasselbe Rätsel' + W, (await puzzle(page)).sig === first.sig);
  await wrong(page);
  ok('mit einem Leben: Hinweis gesperrt' + W, await page.locator('#bh').isDisabled());
  ok('mit einem Leben: Anderes Rätsel gesperrt' + W, await page.locator('#bskip').isDisabled());
  ok('Begründung sichtbar' + W, await page.locator('#lock').isVisible());
  await shot(page, 'gesperrt', width);
  await wrong(page);
  ok('Abschlussansicht nach drittem Fehler' + W, (await page.locator('h2').textContent()) === 'Lauf beendet');
  ok('Abschluss zeigt Erklärung' + W, (await page.locator('.explain').textContent()).length > 10);
  ok('Abschluss zeigt Level und Stufe' + W, /Level/.test(await page.locator('.kv').textContent()) && /Easy/.test(await page.locator('.kv').textContent()));
  await shot(page, 'abschluss', width);

  // 2  Leben zurück bei Level 4; zweiter Lauf hat gemischte Reihenfolge
  await click(page, '[data-act="newrun"]');
  ok('zweiter Lauf ohne Regel-Einblendung' + W, !(await page.locator('.rulesintro').count()));
  let p = await puzzle(page);
  if (p.kind === 'number') { await enter(page, p, p.solution + 1); await click(page, '[data-act="check"]'); }
  else {                                                         // Fehler über den ersten Hinweis (kostet ebenfalls ein Leben)
    await click(page, '#bh'); ok('Hinweis verlangt zweites Antippen' + W, (await lives(page)) === 3 && /kostet ein Leben/.test(await msg(page)));
    await click(page, '#bh'); }
  ok('ein Leben verloren' + W, (await lives(page)) === 2);
  for (let l = 1; l <= 3; l++) { await solve(page); if (l < 3) await click(page, '#bnext'); }
  const notes = await page.locator('#result').textContent();
  ok('Level 4: Leben zurück' + W, /Ein Leben zurück, jetzt 3/.test(notes), notes.slice(0, 200));
  await shot(page, 'geloest', width);
  await click(page, '#bnext');
  ok('Level 4 mit drei Leben' + W, (await lives(page)) === 3 && /Level 4/.test(await page.locator('.gmode').textContent()));
  // Hinweis: erster kostet nach Bestätigung, zweiter nicht
  await click(page, '#bh'); await click(page, '#bh'); const l1 = await lives(page); await click(page, '#bh');
  ok('erster Hinweis kostet ein Leben, zweiter nicht' + W, l1 === 2 && (await lives(page)) === 2);
  await click(page, '#bskip'); ok('Anderes Rätsel verlangt zweites Antippen' + W, (await lives(page)) === 2);
  await click(page, '#bskip'); ok('Anderes Rätsel kostet ein Leben' + W, (await lives(page)) === 1 && /noch 1/.test(await msg(page)));
  // Aufgeben im Menü
  await click(page, '[data-act="menu"]'); await shot(page, 'menu-lauf', width);
  ok('Menü zeigt laufenden Lauf' + W, /Level 4/.test(await page.locator('.mode.endless').textContent()) && (await page.locator('.mode.endless').textContent()).includes('Weiterspielen'));
  await click(page, '[data-act="giveup"]'); ok('Aufgeben verlangt zweites Antippen' + W, (await page.locator('h2').count()) === 0 || (await page.locator('h2').textContent()) !== 'Lauf beendet');
  await click(page, '[data-act="giveup"]');
  ok('Aufgeben beendet den Lauf, Punkte zählen' + W, (await page.locator('h3').first().textContent()) === 'Aufgegeben' && /Neuer Bestwert/.test(await page.locator('.card').textContent()));
  await click(page, '[data-act="menu"]'); await shot(page, 'menu-bestwert', width);
  ok('Menü zeigt besten Lauf' + W, /Bester Lauf/.test(await page.locator('.mode.endless').textContent()) && (await page.locator('.mode.endless').textContent()).includes('Neuer Lauf'));
  await click(page, '[data-act="stats"]');
  ok('Fortschritt: beste Läufe' + W, (await page.locator('.runs li').count()) === 2);
  await shot(page, 'fortschritt', width);

  // 3  Bonus statt Leben, wenn bei Level 4 alle Leben voll sind
  await page.goto(URL); await click(page, '[data-act="endless"]');
  for (let l = 1; l <= 3; l++) { await solve(page); if (l < 3) await click(page, '#bnext'); }
  ok('Level 4 mit vollen Leben: Punktebonus' + W, /\+100 Punkte/.test(await page.locator('#result').textContent()));

  // 4  Alter Spielstand mit Level 18, altes Backup
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('mindshapes.save', JSON.stringify({ v: 1, settings: { sound: false, motion: true, theme: 'magenta' },
    endless: { run: 'altlauf', level: 19, power: 45, salt: 2, clean: 1, bestClean: 6, maxLevel: 18 }, stats: { solved: 120, points: 23456, bestPoints: 410, hints: 9, firstTry: 80, skipped: 3, byType: { number: 20, geometry: 20, equation: 20, spatial: 20, pattern: 20, logic: 20 }, byDiff: [10, 40, 50, 20], bestTime: [9000, 20000, 40000, 60000] },
    daily: { done: { '2026-11-01': { t: 6000, a: 1, h: 0, d: 2, ty: 'equation' } }, streak: 0, longest: 4, last: '2026-11-01', best: 6000, count: 7, prog: null }, unlocked: ['signal', 'ultra', 'magenta'], seen: [], intro: ['number', 'pattern'], record: null })); });
  await page.goto(URL);
  const mt = await page.locator('.mode.endless').textContent();
  ok('alter Stand: Bestwert Level 18 im Menü' + W, /Höchstes Level: 18/.test(mt) && mt.includes('Neuer Lauf'), mt);
  const sv = await page.evaluate(() => JSON.parse(localStorage.getItem('mindshapes.save') || 'null'));
  await click(page, '[data-act="endless"]');
  ok('alter Stand: einmaliger Hinweis' + W, /Dein bisher höchstes Level \(18\)/.test(await page.locator('.rulesintro').textContent()));
  ok('alter Stand: Lauf beginnt bei Level 1' + W, /Level 1 /.test(await page.locator('.gmode').textContent()));
  await click(page, '[data-act="menu"]'); await click(page, '[data-act="stats"]');
  const st = await page.locator('.grid4').first().textContent();
  ok('alter Stand: Punkte gesamt und Level erhalten' + W, st.includes('23.456') && /Höchstes Level in einem Lauf18/.test(st), st.slice(0, 160));
  ok('alter Stand: Freischaltungen und Thema erhalten' + W, await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() === '#f26bd8'));
  await page.goto(URL);
  ok('Spielstand auf Version 2 umgestellt' + W, (await page.evaluate(() => JSON.parse(localStorage.getItem('mindshapes.save')).v)) === 2);
  // Backup im alten Format über die Einstellungen importieren
  await page.evaluate(() => localStorage.clear()); await page.goto(URL); await click(page, '[data-act="settings"]');
  await page.fill('#io', JSON.stringify({ app: 'MIND//SHAPES', format: 1, exported: '2026-11-01T10:00:00Z', save: { v: 1, endless: { run: 'x', level: 7, power: 12, salt: 0, clean: 0, bestClean: 2, maxLevel: 6 }, stats: { solved: 9, points: 1500 }, daily: { done: {} }, unlocked: ['signal'] } }));
  await click(page, '[data-act="importtext"]');
  await page.goto(URL);
  ok('altes Backup importiert' + W, /Höchstes Level: 6/.test(await page.locator('.mode.endless').textContent()) && (await page.evaluate(() => JSON.parse(localStorage.getItem('mindshapes.save')).stats.points)) === 1500);

  // 5  Spielstand mit laufendem Lauf, gemerktes Rätsel ist Easy (nach einer Änderung der Easy-Generatoren wird es neu erzeugt)
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('mindshapes.save', JSON.stringify({ v: 2, settings: { sound: false, motion: true, theme: 'signal' },
    endless: { run: { seed: 'easylauf', level: 2, lives: 2, points: 140, salt: 0, a: 1, h: 1, ms: 12000, fixed: true, picked: true, start: '2026-11-10' }, first: false, bestPoints: 300, bestLevel: 6, runs: [{ p: 300, l: 6, d: '2026-11-09' }], rulesSeen: true, note: false, clean: 0, bestClean: 2 },
    stats: { solved: 8 }, daily: { done: {} }, unlocked: ['signal'], seen: [], intro: ['number', 'pattern', 'equation', 'geometry', 'spatial', 'logic'], record: null })); });
  await page.goto(URL);
  ok('Easy-Lauf: Menü bietet Weiterspielen bei Level 2' + W, /Level 2/.test(await page.locator('.mode.endless').textContent()) && (await page.locator('.mode.endless').textContent()).includes('Weiterspielen'));
  await click(page, '[data-act="endless"]');
  const g = page.locator('.game');
  ok('Easy-Lauf: gemerktes Rätsel ist Easy, Seed aus dem Lauf' + W, (await g.getAttribute('data-d')) === '0' && (await g.getAttribute('data-seed')) === 'E|easylauf|2|0' && /Easy/.test(await page.locator('.tier').textContent()));
  ok('Easy-Lauf: Leben, Versuche und bezahlter Hinweis übernommen' + W, (await lives(page)) === 2 && (await page.locator('#hints li').count()) === 1 && /Level 2 · 140/.test(await page.locator('.gmode').textContent()));
  await page.reload(); await click(page, '[data-act="endless"]');
  ok('Easy-Lauf: nach Neuladen dasselbe Rätsel' + W, (await g.getAttribute('data-seed')) === 'E|easylauf|2|0' && (await lives(page)) === 2);
  await solve(page);
  ok('Easy-Lauf: lösbar, weiter mit Level 3' + W, /weiter mit Level 3 \(Easy\)/.test(await page.locator('#result').textContent()));

  // 6  Daily unverändert: keine Leben, Fehler kosten nichts
  await page.evaluate(() => localStorage.clear()); await page.goto(URL); await click(page, '[data-act="daily"]');
  ok('Daily ohne Lebensanzeige' + W, !(await page.locator('#rlives').count()) && !(await page.locator('#lock').count()));
  p = await puzzle(page);
  if (p.kind === 'number') { await enter(page, p, p.solution + 1); await click(page, '[data-act="check"]'); ok('Daily: Fehler ohne Lebensverlust' + W, !/Leben/.test(await msg(page))); await click(page, '[data-act="restart"]'); }
  await click(page, '#bh'); ok('Daily: Hinweis ohne Rückfrage' + W, (await page.locator('#hints li').count()) === 1);
  await solve(page).catch(() => {});
  ok('Daily gelöst, Ergebnisansicht' + W, /Daily gelöst/.test(await page.locator('h2').textContent()));
  ok('keine Konsolenfehler' + W, !errors.length, errors.join(' | '));
  await ctx.close();
}
await browser.close();
for (const r of results) if (!r.ok) console.log('FEHLER', r.name, r.info);
console.log(`${results.filter(r => r.ok).length} von ${results.length} Prüfungen bestanden`);
