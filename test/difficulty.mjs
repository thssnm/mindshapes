#!/usr/bin/env node
/* MIND//SHAPES – Massentest der Rätselgeneratoren
   Erzeugt je Rätselart und Stufe viele Rätsel und misst, was sich ohne Menschen messen lässt.
   Der Engine-Teil wird unverändert aus index.html geladen (zwischen 'use strict' und dem UI-Block).

   Aufruf:  node test/difficulty.mjs                 300 Rätsel je Typ und Stufe, Markdown-Tabellen
            node test/difficulty.mjs --n 1000        mehr Rätsel
            node test/difficulty.mjs --json out.json zusätzlich alle Rohwerte als JSON
            node test/difficulty.mjs --examples      je Unterart und Stufe ein Beispiel (Prompt, Ansicht, Lösung)

   Kennzahlen je Rätsel (Definitionen, damit die Zahlen nachprüfbar sind):
   raten   Chance, mit dem ersten Versuch blind zu treffen.
           Auswahl: 1/Optionen. Netz-Gegenüber: 1/5. Zahleneingabe: Anteil des häufigsten Lösungswerts
           in derselben Unterart und Stufe (ein Spieler, der immer diese Zahl tippt). Raster, Gleichung,
           Logikgitter, Legepuzzle: Lösungen / Suchraum.
   abk     Erfolgschance eines Spielers, der nur eine einfache Abkürzung kennt und sonst rät
           (je Unterart beschrieben bei ANALYZE). Ist abk deutlich größer als raten, lässt sich das
           Rätsel mit einem Blick lösen.
   lös     Zahl der gültigen Lösungen (Gleichung: verschiedene Belegungen; Legepuzzle: Zerlegungen;
           Malraster: verschiedene Antworten aller Regeln, die zu den sichtbaren Feldern passen).
   raum    log10 der Größe des Suchraums (alle formal möglichen Antworten).
   schr    Denkschritte: Zahl verschiedener Überlegungen, die das Rätsel erzwingt. Wo es messbar ist,
           gemessen (Logikgitter: Runden eines Propagationslösers; Zahlenrätsel: nötige Bedingungen;
           Matrix: veränderliche Eigenschaften), sonst aus der Bauart abgeleitet (bei ANALYZE begründet).
   par     Richtzeit des Spiels in Sekunden: 30 + 14 × rating (aus score()).
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i < 0 ? null : (args[i + 1] ?? true); };
const N = +(opt('--n') || 300), JSON_OUT = opt('--json'), EXAMPLES = args.includes('--examples');

/* ---------------------------------------------------------------- Engine laden */
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const a = html.indexOf("'use strict';"), b = html.indexOf('/* =====================================================================\n   UI');
if (a < 0 || b < 0) throw new Error('Engine-Marker in index.html nicht gefunden');
const EXPORTS = ['generate', 'dailyPuzzle', 'DAILY_VERSION', 'TYPE_KEYS', 'DIFF', 'makeRng', 'hashStr', 'eqSolutions', 'evalTokens', 'fillTpl',
  'foldNet', 'canonRot', 'pNorm', 'P_ROT', 'pKey', 'has2x2', 'pDims', 'OPS2', 'PAINT', 'polyArea', 'cubeStats', 'perms'];
const E = new Function(html.slice(a + 13, b) + `\nreturn {${EXPORTS.map(n => `${n}:typeof ${n}==='undefined'?undefined:${n}`).join(',')}};`)();

/* ---------------------------------------------------------------- Hilfen */
const log10 = x => Math.log10(Math.max(1, x));
const fact = n => n <= 1 ? 1 : n * fact(n - 1);
const perm = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r *= n - i; return r; };
const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
const f1 = x => Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)) : '–';
const pc = x => Number.isFinite(x) ? (x * 100 < 1 && x > 0 ? '<1' : (x * 100).toFixed(0)) + ' %' : '–';

/* Logikgitter: Hinweistexte zurück in Bedingungen übersetzen und mit einem menschenähnlichen
   Propagationslöser lösen (Einzelhinweise auf Wertebereiche anwenden, Alle-verschieden mit
   „nur noch ein Platz“/„nur noch ein Kandidat“). Gezählt werden die Runden bis zur Lösung;
   bleibt der Löser stecken, braucht das Gitter eine Fallunterscheidung. */
const SH = ['Kreis', 'Dreieck', 'Quadrat', 'Raute', 'Sechseck'];
const CO = ['cyan', 'violett', 'magenta', 'gelb', 'weiß'];
const CO_ADJ = ['cyanfarbene', 'violette', 'magentafarbene', 'gelbe', 'weiße'], CO_DAT = ['cyanfarbenen', 'violetten', 'magentafarbenen', 'gelben', 'weißen'];
function logicSolve(p) {
  const v = p.view, Nn = v.N, items = [];
  v.shapes.forEach((s, i) => items.push({ cat: 0, i, names: [SH[s]] }));
  if (v.cats === 2) v.colors.forEach((c, i) => items.push({ cat: 1, i, names: [CO_ADJ[c] + ' Form', CO_DAT[c] + ' Form'], col: CO[c] }));
  const find = s => { s = s.replace(/^(Der|Die|Das|dem|der|vom) /, '').replace(/^(dem|der) /, ''); return items.findIndex(it => it.names.some(n => s === n)); };
  const C = [];
  for (const t of v.clues) {
    let m;
    if ((m = t.match(/^(.*) ist (nicht )?(\S+)\.$/))) { const x = find(m[1]), c = items.findIndex(it => it.col === m[3]); C.push({ ty: m[2] ? 'ns' : 'same', x, y: c }); }
    else if ((m = t.match(/^(.*) steht (nicht )?auf Platz (\d)\.$/))) C.push({ ty: m[2] ? 'na' : 'at', x: find(m[1]), p: +m[3] - 1 });
    else if ((m = t.match(/^(.*) steht (nicht )?am Rand\.$/))) C.push({ ty: m[2] ? 'nedge' : 'edge', x: find(m[1]) });
    else if ((m = t.match(/^(.*) steht irgendwo links (?:von|vom) (.*)\.$/))) C.push({ ty: 'lo', x: find(m[1]), y: find(m[2]) });
    else if ((m = t.match(/^(.*) steht direkt links (?:von|vom) (.*)\.$/))) C.push({ ty: 'dl', x: find(m[1]), y: find(m[2]) });
    else if ((m = t.match(/^(.*) steht (nicht )?direkt neben (.*)\.$/))) C.push({ ty: m[2] ? 'nadj' : 'adj', x: find(m[1]), y: find(m[3]) });
    else throw new Error('Hinweis nicht verstanden: ' + t);
  }
  if (C.some(c => c.x < 0 || c.y < 0)) throw new Error('Name nicht gefunden: ' + JSON.stringify(v.clues));
  const unary = (c, q) => c.ty === 'at' ? q === c.p : c.ty === 'na' ? q !== c.p : c.ty === 'edge' ? (q === 0 || q === Nn - 1) : c.ty === 'nedge' ? !(q === 0 || q === Nn - 1) : true;
  const bin = (c, q, r) => c.ty === 'same' ? q === r : c.ty === 'ns' ? q !== r : c.ty === 'lo' ? q < r : c.ty === 'dl' ? r - q === 1 : c.ty === 'adj' ? Math.abs(q - r) === 1 : c.ty === 'nadj' ? Math.abs(q - r) > 1 : true;
  const dom = items.map(() => new Set(Array.from({ length: Nn }, (_, i) => i)));
  let rounds = 0;
  const solvedAll = () => dom.every(d => d.size === 1);
  while (!solvedAll()) {
    let changed = false; rounds++;
    for (const c of C) {
      if (c.y === undefined) { for (const q of [...dom[c.x]]) if (!unary(c, q)) { dom[c.x].delete(q); changed = true; } continue; }
      const sameCat = items[c.x].cat === items[c.y].cat;
      for (const q of [...dom[c.x]]) if (![...dom[c.y]].some(r => (!sameCat || r !== q) && bin(c, q, r))) { dom[c.x].delete(q); changed = true; }
      for (const r of [...dom[c.y]]) if (![...dom[c.x]].some(q => (!sameCat || r !== q) && bin(c, q, r))) { dom[c.y].delete(r); changed = true; }
    }
    for (const cat of [0, 1]) {
      const its = items.map((it, k) => k).filter(k => items[k].cat === cat); if (!its.length) continue;
      for (const k of its) if (dom[k].size === 1) { const q = [...dom[k]][0]; for (const o of its) if (o !== k && dom[o].delete(q)) changed = true; }
      for (let q = 0; q < Nn; q++) { const hs = its.filter(k => dom[k].has(q)); if (hs.length === 1 && dom[hs[0]].size > 1) { dom[hs[0]] = new Set([q]); changed = true; } }
    }
    if (!changed) break;
  }
  return { rounds, stuck: !solvedAll(), direct: C.filter(c => c.ty === 'at').length, clues: C.length };
}

/* Legepuzzle: alle Zerlegungen der Zielfläche in die Teile zählen (nur Drehen, kein Spiegeln, wie im Spiel). */
function assembleCount(p, cap = 5000) {
  const tg = new Set(p.view.target.map(([x, y]) => x + ',' + y)), cells = p.view.target.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const rots = p.view.pieces.map(pc => { const out = [], seen = new Set(); let c = pc.cells.map(q => [q[0], q[1], 0]);
    for (let r = 0; r < 4; r++) { const n = E.pNorm(c), k = E.pKey(n); if (!seen.has(k)) { seen.add(k); out.push(n.map(q => [q[0], q[1]])); } c = E.P_ROT(c); } return out; });
  const shapeKey = p.view.pieces.map(pc => E.canonRot(pc.cells.map(q => [q[0], q[1], 0])));
  let place = 1; rots.forEach(rs => { let n = 0; rs.forEach(r => cells.forEach(([x, y]) => { if (r.every(([a, b]) => tg.has((a + x) + ',' + (b + y)))) n++; })); place *= Math.max(1, n); });
  const used = rots.map(() => false), filled = new Set(); let count = 0;
  (function rec() {
    if (count >= cap) return;
    const first = cells.find(([x, y]) => !filled.has(x + ',' + y)); if (!first) { count++; return; }
    for (let i = 0; i < rots.length; i++) {
      if (used[i] || shapeKey.some((k, j) => j < i && !used[j] && k === shapeKey[i])) continue;
      for (const r of rots[i]) {
        const [ax, ay] = r[0], dx = first[0] - ax, dy = first[1] - ay, ks = r.map(([a, b]) => (a + dx) + ',' + (b + dy));
        if (!ks.every(k => tg.has(k) && !filled.has(k))) continue;
        used[i] = true; ks.forEach(k => filled.add(k)); rec(); ks.forEach(k => filled.delete(k)); used[i] = false;
      }
    }
  })();
  return { count, space: place };
}

/* Malraster: alle Regeln der Familie (alle Parameter) gegen die sichtbaren Felder prüfen. */
function paintRules(n, k) {
  const R = [];
  for (const name of ['diag', 'anti', 'ring', 'diamond', 'blocks', 'mult']) for (let o = 0; o < k; o++) R.push({ name, f: (r, c) => E.PAINT[name].f(r, c, n, k, { o, a: 1, b: 1 }) });
  for (let a = 0; a < k; a++) for (let bb = 0; bb < k; bb++) for (let o = 0; o < k; o++) R.push({ name: 'lin', f: (r, c) => (a * r + bb * c + o) % k });
  return R;
}
function paintAnalyze(p) {
  const v = p.view, n = v.n, k = v.k, vis = v.grid.map((g, i) => [g, i]).filter(([g]) => g >= 0);
  const answers = new Set(); let simple = false;
  const right = p.solution.join();
  for (const rl of paintRules(n, k)) {
    if (!vis.every(([g, i]) => rl.f(Math.floor(i / n), i % n) === g)) continue;
    const ans = v.miss.map(i => rl.f(Math.floor(i / n), i % n)).join(); answers.add(ans);
    if (['diag', 'anti'].includes(rl.name) || (rl.name === 'lin' && 0)) if (ans === right) simple = true;
  }
  // Spiegelsymmetrie an beiden Mittelachsen (Regel sym4): jedes Loch hat einen sichtbaren Partner
  const orb = i => { const r = Math.floor(i / n), c = i % n; return Math.min(r, n - 1 - r) * n + Math.min(c, n - 1 - c); };
  const by = new Map(); let sym = true; vis.forEach(([g, i]) => { const o = orb(i); if (by.has(o) && by.get(o) !== g) sym = false; by.set(o, g); });
  if (sym && v.miss.every(i => by.has(orb(i)))) answers.add(v.miss.map(i => by.get(orb(i))).join());
  if (!answers.size) answers.add(right);
  return { sols: answers.size, simple };
}

/* Mehrheitsabkürzung für Auswahl aus Merkmalskombinationen: die Option wählen, deren Merkmalswerte
   unter den Optionen am häufigsten vorkommen (Falschoptionen entstehen durch Abwandeln der richtigen). */
function majority(opts, keys, ans) {
  const sc = opts.map(o => keys.reduce((s, kk) => s + opts.filter(q => q[kk] === o[kk]).length, 0)), mx = Math.max(...sc), top = sc.map((s, i) => s === mx ? i : -1).filter(i => i >= 0);
  return top.includes(ans) ? 1 / top.length : 0;
}
const bboxA = poly => { const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); };
const pickBy = (vals, ans, better) => { const best = vals.reduce((m, x) => better(x, m) ? x : m, vals[0]), top = vals.map((x, i) => x === best ? i : -1).filter(i => i >= 0); return top.includes(ans) ? 1 / top.length : 0; };
const lineRun = (cells, len) => { const s = new Set(cells.map(c => c[0] + ',' + c[1])); return cells.some(([x, y]) => [[1, 0], [0, 1]].some(([dx, dy]) => { for (let i = 1; i < len; i++) if (!s.has((x + dx * i) + ',' + (y + dy * i))) return false; return true; })); };
const diffOrder = t => { let d = t.slice(); for (let k = 1; k <= 3; k++) { d = d.slice(1).map((x, i) => x - d[i]); if (d.length >= 2 && d.every(x => x === d[0])) return k; } return 0; };

/* ---------------------------------------------------------------- Analyse je Unterart */
const ANALYZE = {
  // Folge. abk: lineare Fortsetzung aus den beiden Nachbarn links (oder rechts). schr: Ordnung der
  // Differenzenfolge (1 = gleicher Abstand, 2 = Abstände wachsen gleichmäßig …); 2 für alles andere (Regel muss erkannt werden).
  seq(p) {
    const t = p.view.terms.map(x => x == null ? p.solution : x), g = p.view.terms.indexOf(null), n = t.length;
    const pred = g >= 2 ? 2 * t[g - 1] - t[g - 2] : 2 * t[g + 1] - t[g + 2];
    const o = diffOrder(t);
    return { short: pred === p.solution ? 1 : 0, steps: o === 1 ? 1 : 2, space: 0, sols: 1, num: true, tag: o ? 'Diff-Ordnung ' + o : 'andere Regel' };
  },
  // Zahlenmaschine: eine Regel der Form m·x+c oder x²+c. Ein Schritt.
  machine(p) { return { short: null, steps: 1, sols: 1, num: true }; },
  // Geheimer Operator: eine Formel aus 18. raum = Formeln, die nach der ersten Zeile noch passen.
  op(p) {
    const [a, bb] = p.view.rows[0][0].split(' ◇ ').map(Number), r0 = +p.view.rows[0][1];
    const fit = E.OPS2.filter(o => o.f(a, bb) === r0).length;
    return { short: null, steps: 1, sols: 1, num: true, space: log10(E.OPS2.length), tag: 'nach Zeile 1 passen ' + fit };
  },
  // Zahlenrätsel: jede Bedingung ist ein Filter, alle nötig. schr = Zahl der Bedingungen.
  riddle(p) {
    const three = p.prompt.includes('dreistellige');
    return { short: null, steps: p.view.lines.length, sols: 1, num: true, space: log10(three ? 900 : 90) };
  },
  // Würfelbau. count: Türme addieren (1). fill: Quader rechnen und abziehen (2). hidden: verdeckte Würfel finden und zählen (1–2).
  cubes(p) {
    const mode = p.sig.split(':')[1];
    return { short: null, steps: mode === 'count' ? 1 : 2, sols: 1, num: true, tag: mode };
  },
  // Gleichung. lös: verschiedene gültige Belegungen. raum: alle Belegungen. schr: 1 bei bis zu 3 Zahlen, 2 ab 4 Zahlen.
  build(p) { return ANALYZE._eq(p); },
  fusion(p) { const r = ANALYZE._eq(p); r.steps += 1; r.tag = (p.fusion === 'Spatial Logic' ? 'Würfel' : 'Folge') + ' · ' + r.tag; return r; },
  _eq(p) {
    const v = p.view, nN = v.tpl.filter(x => x === 'N').length, nO = v.tpl.filter(x => x === 'O').length;
    const sols = E.eqSolutions(v.tpl, v.nums, v.ops, v.target, 100000).length;
    const space = perm(v.nums.length, nN) * perm(v.ops.length, nO);
    return { short: null, steps: nN >= 4 ? 2 : 1, sols, space: log10(space), guess: sols / space, tag: nN + ' Zahlen' };
  },
  // Würfelnetz, Gegenüber. abk: „in einer geraden Reihe liegt das Gegenüber zwei Felder weiter“, sonst raten (1/5).
  netopp(p) {
    const c = p.view.cells, m = c[p.view.mark], at = (x, y) => c.findIndex(q => q[0] === x && q[1] === y), hits = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const mid = at(m[0] + dx, m[1] + dy), far = at(m[0] + 2 * dx, m[1] + 2 * dy); if (mid >= 0 && far >= 0) hits.push(far); }
    const short = hits.length === 1 ? (hits[0] === p.solution ? 1 : 0) : 0.2;
    return { guess: 0.2, short, steps: hits.length === 1 ? 1 : 2, sols: 1, space: log10(5) };
  },
  // Gültiges Netz. abk: Netze mit sichtbarem Fehler (2×2-Block oder fünf in einer Reihe) aussortieren, unter dem Rest raten.
  netvalid(p) {
    const o = p.view.opts, bad = o.map(c => E.has2x2(c) || lineRun(c, 5)), want = p.prompt.startsWith('Nur eines');
    let short;
    if (want) { const rest = o.map((c, i) => i).filter(i => !bad[i]); short = rest.includes(p.solution) ? 1 / rest.length : 0; }
    else { const def = o.map((c, i) => i).filter(i => bad[i]); short = def.length ? (def.includes(p.solution) ? 1 / def.length : 0) : 1 / o.length; }
    const rest = want ? o.filter((c, i) => !bad[i]).length : (bad.filter(Boolean).length || o.length);
    return { guess: 1 / o.length, short, steps: rest > 1 ? 2 : 1, sols: 1, space: log10(o.length), tag: want ? 'gültiges suchen' : 'ungültiges suchen' };
  },
  // Drehfigur. abk: nur den Umriss vergleichen (Markierungen ignorieren), unter passenden Umrissen raten.
  rotate(p) {
    const strip = c => E.canonRot(c.map(q => [q[0], q[1], 0])), ref = strip(p.view.ref), o = p.view.opts;
    const same = o.map((c, i) => strip(c) === ref ? i : -1).filter(i => i >= 0);
    return { guess: 1 / o.length, short: same.includes(p.solution) ? 1 / same.length : 0, steps: same.length > 1 ? 2 : 1, sols: 1, space: log10(o.length) };
  },
  // Flächen. abk: größte/kleinste Umrandungsbox wählen; bei „gleich groß“ die Option mit gleicher Box wie die Vorlage.
  area(p) {
    const o = p.view.opts, bx = o.map(bboxA), mode = p.prompt.includes('größte') ? 'max' : p.prompt.includes('kleinste') ? 'min' : 'equal';
    let short;
    if (mode === 'max') short = pickBy(bx, p.solution, (x, m) => x > m);
    else if (mode === 'min') short = pickBy(bx, p.solution, (x, m) => x < m);
    else { const rb = bboxA(p.view.ref), top = bx.map((x, i) => x === rb ? i : -1).filter(i => i >= 0); short = top.length ? (top.includes(p.solution) ? 1 / top.length : 0) : 1 / o.length; }
    return { guess: 1 / o.length, short, steps: mode === 'equal' ? 2 : 1, sols: 1, space: log10(o.length), tag: mode };
  },
  // Legepuzzle. lös: Zerlegungen. raum: Produkt der Lagen je Teil. schr: 1 bei bis zu 3 Teilen, sonst 2.
  assemble(p) {
    const { count, space } = assembleCount(p);
    return { guess: count / space, short: null, steps: p.view.pieces.length > 3 ? 2 : 1, sols: count, space: log10(space), tag: p.view.pieces.length + ' Teile' };
  },
  // Symmetrie. Eine Regel, mehrfach angewendet. raum: 2^freie Felder.
  sym(p) {
    const v = p.view, free = v.n * v.n - v.given.length;
    return { guess: 0, short: null, steps: 1, sols: 1, space: free * Math.log10(2), tag: v.type + ' · ' + p.solution.length + ' Felder' };
  },
  // Matrix. abk: Mehrheitsoption. schr: Zahl der veränderlichen Eigenschaften (je eine Regel).
  matrix(p) {
    const keys = ['s', 'c', 'n', 'f'], nv = keys.filter(kk => new Set(p.view.cells.map(c => c[kk])).size > 1).length;
    return { guess: 1 / p.view.opts.length, short: majority(p.view.opts, keys, p.solution), steps: nv, sols: 1, space: log10(p.view.opts.length), tag: nv + ' Eigenschaften' };
  },
  // Malraster. lös: verschiedene Antworten aller Familienregeln, die zu den sichtbaren Feldern passen.
  // abk: eine reine Diagonalregel trifft. Eine Regel, mehrfach angewendet: schr = 1.
  paint(p) {
    const r = paintAnalyze(p), v = p.view, space = v.miss.length * Math.log10(v.k);
    return { guess: Math.pow(1 / v.k, v.miss.length), short: r.simple ? 1 : 0, steps: 1, sols: r.sols, space, tag: v.miss.length + ' Löcher' };
  },
  // Logikgitter. schr: Runden des Propagationslösers. Fallunterscheidung, wenn er stecken bleibt.
  grid(p) {
    const r = logicSolve(p), v = p.view, space = Math.pow(fact(v.N), v.cats);
    return { guess: 1 / space, short: null, steps: r.rounds + (r.stuck ? 1 : 0), stuck: r.stuck, sols: 1, space: log10(space), tag: `${v.N}×${v.cats} · ${r.clues} Hinweise, ${r.direct} direkt` };
  }
};

/* ---------------------------------------------------------------- Lauf */
const rows = [], timing = {}, issues = [];
for (const type of E.TYPE_KEYS) for (let d = 0; d < 4; d++) {
  const ts = [];
  for (let i = 0; i < N; i++) {
    const seed = `MASS|${i}`;
    const t0 = performance.now(), p = E.generate(seed, type, d), dt = performance.now() - t0; ts.push(dt);
    if (p.sig.startsWith('fb:')) issues.push(`Notlösung: ${type} d${d} ${seed}`);
    if (p.validate(p.solution) !== true) issues.push(`validate(solution) falsch: ${type} d${d} ${seed}`);
    if (i < 20) { const q = E.generate(seed, type, d); if (q.sig !== p.sig) issues.push(`nicht deterministisch: ${type} d${d} ${seed}`); }
    const m = ANALYZE[p.sub](p);
    rows.push({ type, d, sub: p.sub, rating: p.rating, par: 30 + 14 * p.rating, sol: JSON.stringify(p.solution), ...m, p });
  }
  timing[type + d] = { mean: mean(ts), max: Math.max(...ts) };
}
// Zahleneingabe: Ratechance = Anteil des häufigsten Lösungswerts je Unterart und Stufe
const bucket = new Map();
rows.forEach(r => { const k = r.type + r.sub + r.d + (r.tag && r.sub === 'cubes' ? r.tag : ''); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(r); });
bucket.forEach(rs => { if (!rs[0].num) return; const cnt = {}; rs.forEach(r => cnt[r.sol] = (cnt[r.sol] || 0) + 1); const mx = Math.max(...Object.values(cnt)) / rs.length; rs.forEach(r => r.guess = mx); });

/* ---------------------------------------------------------------- Ausgabe */
const out = [];
out.push(`# Massentest MIND//SHAPES (${N} Rätsel je Typ und Stufe, ${DAILY_LABEL()})\n`);
function DAILY_LABEL() { return E.DAILY_VERSION.replace(/_$/, ''); }
out.push('| Typ | Stufe | Unterart | Anteil | par s | raten | abk | lös Ø / max / eindeutig | raum log10 | schr Ø (min) | Merkmal (häufigstes) |');
out.push('|---|---|---|---:|---:|---:|---:|---|---:|---|---|');
for (const type of E.TYPE_KEYS) for (let d = 0; d < 4; d++) {
  const rs = rows.filter(r => r.type === type && r.d === d), subs = [...new Set(rs.map(r => r.sub))];
  for (const sub of subs) {
    const s = rs.filter(r => r.sub === sub), sh = s.filter(r => r.short != null), tags = {};
    s.forEach(r => { if (r.tag) tags[r.tag] = (tags[r.tag] || 0) + 1; });
    const tg = Object.entries(tags).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, n]) => `${k} (${Math.round(n / s.length * 100)} %)`).join(', ');
    const sols = s.map(r => r.sols);
    out.push(`| ${type} | ${E.DIFF[d]} | ${sub} | ${pc(s.length / rs.length)} | ${f1(mean(s.map(r => r.par)))} | ${pc(mean(s.map(r => r.guess)))} | ${sh.length ? pc(mean(sh.map(r => r.short))) : '–'} | ${f1(mean(sols))} / ${Math.max(...sols)} / ${pc(sols.filter(x => x === 1).length / s.length)} | ${f1(mean(s.map(r => r.space || 0)))} | ${f1(mean(s.map(r => r.steps)))} (${Math.min(...s.map(r => r.steps))}) | ${tg} |`);
  }
}
const gr = rows.filter(r => r.sub === 'grid');
out.push('\n## Logikgitter: Propagationslöser\n');
out.push('| Stufe | Runden Ø | Runden max | bleibt stecken |'); out.push('|---|---:|---:|---:|');
for (let d = 0; d < 4; d++) { const s = gr.filter(r => r.d === d); out.push(`| ${E.DIFF[d]} | ${f1(mean(s.map(r => r.steps)))} | ${Math.max(...s.map(r => r.steps))} | ${pc(s.filter(r => r.stuck).length / s.length)} |`); }

out.push('\n## Erzeugungszeit je Aufruf von generate (Node, dieser Rechner)\n');
out.push('| Typ | ' + E.DIFF.join(' | ') + ' |'); out.push('|---|---:|---:|---:|---:|');
for (const type of E.TYPE_KEYS) out.push(`| ${type} | ${[0, 1, 2, 3].map(d => `${timing[type + d].mean.toFixed(2)} / ${timing[type + d].max.toFixed(1)} ms`).join(' | ')} |`);

// Daily: zwei Jahre ab dem Start
const days = [], start = Date.parse('2026-01-01T00:00:00Z');
for (let i = 0; i < 730; i++) { const date = new Date(start + i * 864e5).toISOString().slice(0, 10), p = E.dailyPuzzle(date); days.push({ date, p, m: ANALYZE[p.sub](p) }); }
out.push(`\n## Daily (${days.length} Tage ab 2026-01-01)\n`);
out.push('| Typ | Normal | Hard | par s Ø | Unterarten |'); out.push('|---|---:|---:|---:|---|');
for (const type of E.TYPE_KEYS) {
  const s = days.filter(x => x.p.type === type), subs = {}; s.forEach(x => subs[x.p.sub] = (subs[x.p.sub] || 0) + 1);
  out.push(`| ${type} | ${s.filter(x => x.p.diff === 1).length} | ${s.filter(x => x.p.diff === 2).length} | ${f1(mean(s.map(x => 30 + 14 * x.p.rating)))} | ${Object.entries(subs).map(([k, n]) => k + ' ' + n).join(', ')} |`);
}
const chDays = days.filter(x => x.m.guess != null && x.m.guess >= 0.1).length;
out.push(`\nDailys mit Auswahlantwort oder Ratechance ≥ 10 %: ${chDays} von ${days.length} (${pc(chDays / days.length)}).`);

out.push('\n## Prüfungen\n');
out.push(issues.length ? issues.slice(0, 30).map(x => '- ' + x).join('\n') + (issues.length > 30 ? `\n- … ${issues.length - 30} weitere` : '') : '- Keine Notlösung, validate(solution) überall wahr, gleiche Seeds ergeben gleiche Rätsel (Stichprobe je 20).');
console.log(out.join('\n'));

if (EXAMPLES) {
  console.log('\n## Beispiele\n');
  const seen = new Set();
  rows.forEach(r => { const k = r.type + r.sub + r.d; if (seen.has(k)) return; seen.add(k);
    const v = { ...r.p.view }; console.log(`### ${r.type} · ${E.DIFF[r.d]} · ${r.sub}\n${r.p.prompt}\n  Ansicht: ${JSON.stringify(v).slice(0, 400)}\n  Lösung: ${r.sol.slice(0, 200)}\n  Erklärung: ${r.p.explain}\n`); });
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows.map(({ p, ...r }) => ({ ...r, sig: p.sig })), null, 1));
