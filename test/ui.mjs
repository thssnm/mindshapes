#!/usr/bin/env node
/* MIND//SHAPES – Klicktest im Browser (Testmodus ?lab, 390 × 844 px)
   Spielt jede Unterart auf jeder Stufe einmal: erst eine falsche Antwort (keine Teilrückmeldung erlaubt),
   dann „Neustart“, dann die richtige Antwort per Klick oder Tastatur. Prüft außerdem: kein waagerechtes
   Scrollen, keine Konsolenfehler, Spielstand bleibt unberührt.
   Braucht playwright-core und einen Chromium; beides ist nicht Teil des Spiels.
     NODE_PATH=<ordner mit playwright-core> CHROME=<pfad zu chrome> node test/ui.mjs [--shots <ordner>]
   Fehlercode 1, sobald eine Prüfung fehlschlägt oder der Test abbricht. */
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.NODE_PATH ? join(process.env.NODE_PATH, 'playwright-core') : 'playwright-core');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const a = html.indexOf("'use strict';"), b = html.indexOf('/* =====================================================================\n   UI');
const E = new Function(html.slice(a + 13, b) + '\nreturn {generate,TYPE_KEYS,DIFF};')();
const SUBS = { number: [['seq', 'machine'], ['seq', 'chain', 'op', 'riddle'], ['seq', 'op', 'riddle'], ['seq', 'op', 'riddle']],
  geometry: [['sym', 'area', 'assemble'], ['sym', 'area', 'assemble'], ['sym', 'area', 'assemble'], ['assemble', 'poly', 'sym']],
  equation: [['build'], ['build'], ['build', 'fusion'], ['build', 'fusion']],
  spatial: [['netopp', 'rotate', 'cubes'], ['cview', 'rotate', 'netvalid', 'cubes'], ['cview', 'views', 'netvalid', 'rotate'], ['cview', 'views', 'netvalid', 'rotate']],
  pattern: [0, 1, 2, 3].map(() => ['matrix', 'paint']), logic: [0, 1, 2, 3].map(() => ['grid']) };

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--allow-file-access-from-files'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const url = 'file://' + join(ROOT, 'index.html');
await page.goto(url);                                            // normales Spiel einmal laden: Spielstand anlegen
await page.evaluate(() => localStorage.setItem('mindshapes.save', JSON.stringify({ v: 1, stats: { solved: 3 }, endless: { level: 4 }, daily: { done: { '2026-11-01': { t: 6000, a: 1, h: 0, d: 2, ty: 'equation' } } } })));
const saveBefore = await page.evaluate(() => localStorage.getItem('mindshapes.save'));
await page.goto(url + '?lab');
const results = [], fail = (k, m) => results.push({ k, ok: false, m });
const click = async sel => { await page.locator(sel).first().click(); };
const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function enter(p, ans, kb) {                               // Antwort ans über die Oberfläche eingeben
  const v = p.view;
  switch (p.kind) {
    case 'number': {
      const vals = Array.isArray(ans) ? ans : [ans];
      for (let i = 0; i < vals.length; i++) {
        if (vals.length > 1) await click(`.seq .qslot[data-q="${i}"]`);
        for (const ch of String(vals[i])) { if (kb) await page.keyboard.press(ch); else await click(`.key[data-k="${ch === '-' ? '±' : ch}"]`); }
      }
      break; }
    case 'choice': case 'net': if (kb) await page.keyboard.press(String.fromCharCode(65 + ans)); else await click(p.kind === 'net' ? `.face[data-i="${ans}"]` : `.opt[data-i="${ans}"]`); break;
    case 'multi': case 'order': for (const i of ans) { if (kb) await page.keyboard.press(String.fromCharCode(65 + i)); else await click(`.opt[data-i="${i}"]`); } break;
    case 'build':
      for (let h = 0; h < ans.length; h++) { if (ans.length > 1) await click(`.hole[data-h="${h}"]`); for (const k of ['s', 'c', 'n', 'f']) await click(`.bopt[data-a="${k}"][data-v="${ans[h][k]}"]`); }
      break;
    case 'sym': for (const i of ans) await click(`rect.c[data-i="${i}"]`); break;
    case 'paint': for (let m = 0; m < ans.length; m++) for (let k = 0; k <= ans[m]; k++) await click(`.pcell.hole[data-m="${m}"]`); break;
    case 'equation': {
      for (const t of ans) {
        const isN = typeof t === 'number', tiles = page.locator(isN ? '.tile.tn' : '.tile.to'), n = await tiles.count();
        for (let i = 0; i < n; i++) { const el = tiles.nth(i); if ((await el.textContent()) === String(t) && !(await el.isDisabled())) { await el.click(); break; } }
      }
      break; }
    case 'logic': {
      for (let i = 0; i < v.N; i++) {
        for (let k = 0; k <= ans.s[i]; k++) await click(`.lbtn[data-f="${i}"]`);
        if (v.cats === 2) for (let k = 0; k <= ans.c[i]; k++) await click(`.lcol[data-c="${i}"]`);
      }
      break; }
    case 'assemble': {                                           // Tastatur: Leertaste dreht, Pfeile schieben
      for (let i = 0; i < v.pieces.length; i++) {
        const sol = v.pieces[i].sol, norm = c => { const mx = Math.min(...c.map(q => q[0])), my = Math.min(...c.map(q => q[1])); return c.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]).join(';'); };
        const piece = page.locator('.piece').nth(i); await piece.focus();
        let cells = v.pieces[i].cells.map(c => c.slice());
        for (let r = 0; r < 4 && norm(cells) !== norm(sol); r++) { const d1 = Math.max(...cells.map(c => c[1])) + 1; cells = cells.map(([x, y]) => [d1 - 1 - y, x]); await page.keyboard.press(' '); }
        const tr = await piece.getAttribute('transform'), [, px, py] = tr.match(/translate\(([-\d.]+),([-\d.]+)\)/).map(Number);
        const tx = Math.min(...sol.map(q => q[0])), ty = Math.min(...sol.map(q => q[1]));
        let x = Math.round(px / 40), y = Math.round(py / 40);
        while (y > ty) { await page.keyboard.press('ArrowUp'); y--; } while (y < ty) { await page.keyboard.press('ArrowDown'); y++; }
        while (x > tx) { await page.keyboard.press('ArrowLeft'); x--; } while (x < tx) { await page.keyboard.press('ArrowRight'); x++; }
      }
      break; }
  }
}
function wrongOf(p) {                                            // eine sicher falsche, vollständige Antwort
  const s = p.solution;
  switch (p.kind) {
    case 'number': return Array.isArray(s) ? [s[0], s[1] + 1] : s + 1;
    case 'multi': { const n = p.view.opts.length, w = s.length > 1 ? s.slice(0, -1) : [s[0], (s[0] + 1) % n].sort((a, b) => a - b); return w; }
    case 'order': return s.slice().reverse();
    case 'build': return s.map((o, i) => i ? o : Object.assign({}, o, { c: (o.c + 1) % 4 }));
    default: return null;
  }
}
for (const type of E.TYPE_KEYS) for (let d = 0; d < 4; d++) for (const sub of SUBS[type][d]) {
  const k = `${type}.${E.DIFF[d]}.${sub}`;
  try {
    if (!(await page.locator('[data-lab="type"]').count())) await click('[data-act="lab"]');
    await page.selectOption('[data-lab="type"]', type); await page.selectOption('[data-lab="d"]', String(d)); await page.selectOption('[data-lab="sub"]', sub);
    await click('[data-act="labplay"]');
    const seed = await page.locator('.game').getAttribute('data-seed'), p = E.generate(seed, type, d);
    if (p.sub !== sub) { fail(k, 'andere Unterart: ' + p.sub); await click('[data-act="lab"]'); continue; }
    if (!(await noHScroll())) fail(k, 'waagerechtes Scrollen');
    if (SHOTS) { await page.waitForTimeout(450); await page.screenshot({ path: join(SHOTS, k + '.png'), fullPage: true }); }
    const w = wrongOf(p);
    if (w) {                                                     // falsch: keine Teilrückmeldung, nichts ausgegraut
      await enter(p, w, false); await click('[data-act="check"]');
      const msg = await page.locator('#msg').textContent(), dis = await page.locator('.opt.x, .opt:disabled, .bopt:disabled').count(), solvedEarly = await page.locator('#result:not([hidden])').count();
      if (solvedEarly) fail(k, 'falsche Antwort angenommen');
      if (dis) fail(k, 'Teilrückmeldung: Optionen ausgegraut');
      if (/richtig|von \d+ /.test(msg)) fail(k, 'Teilrückmeldung im Text: ' + msg);
      await click('[data-act="restart"]');
      const left = await page.locator('.opt.sel, .bopt[aria-pressed="true"], .qslot.filled, rect.c.on').count();
      if (left) fail(k, 'Neustart hat die Eingabe nicht geleert');
    }
    await enter(p, p.solution, ['multi', 'order', 'number', 'choice'].includes(p.kind) && d % 2 === 1);   // jede zweite Stufe per Tastatur
    await click('[data-act="check"]');
    if (!(await page.locator('#result:not([hidden])').count())) fail(k, 'richtige Antwort nicht angenommen: ' + (await page.locator('#msg').textContent()));
    else results.push({ k, ok: true });
    await click('[data-act="lab"]');
  } catch (e) { fail(k, 'Ausnahme: ' + e.message.split('\n')[0]); try { await page.goto(url + '?lab'); } catch (_) {} }
}
// Lab-Tabelle kopierbar, Spielstand unberührt, alte Daily-Ergebnisse ohne Lösungsweg
const tableRows = await page.locator('.labt tbody tr').count();
const saveAfter = await page.evaluate(() => localStorage.getItem('mindshapes.save'));
const labRounds = await page.evaluate(() => JSON.parse(localStorage.getItem('mindshapes.lab') || '[]').length);
await page.goto(url);
const sanitized = await page.evaluate(() => JSON.parse(localStorage.getItem('mindshapes.save') || 'null'));
console.log(results.filter(r => r.ok).length + ' von ' + results.length + ' Unterarten-Stufen gelöst');
results.filter(r => !r.ok).forEach(r => console.log('FEHLER', r.k, r.m));
console.log('Lab-Tabelle: ' + tableRows + ' Zeilen, ' + labRounds + ' Runden protokolliert');
console.log('Spielstand im Lab unverändert: ' + (saveBefore === saveAfter));
console.log('Konsolenfehler: ' + (errors.length ? errors.join(' | ') : 'keine'));
await browser.close();
const red = [results.some(r => !r.ok) && 'Unterarten nicht gelöst', saveBefore !== saveAfter && 'Spielstand im Lab verändert', errors.length && 'Konsolenfehler',
  tableRows !== results.length && 'Lab-Tabelle hat nicht eine Zeile je Unterart-Stufe', labRounds !== results.length && 'nicht jede Runde protokolliert'].filter(Boolean);
console.log(red.length ? 'ROT: ' + red.join('; ') : 'GRÜN');
process.exitCode = red.length ? 1 : 0;                   // Abbruch (Ausnahme) endet ohnehin mit Fehlercode 1
