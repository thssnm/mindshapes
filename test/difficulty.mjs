#!/usr/bin/env node
/* MIND//SHAPES – Massentest der Rätselgeneratoren
   Erzeugt je Rätselart und Stufe viele Rätsel, misst, was sich ohne Menschen messen lässt, und prüft die
   Garantien mit eigenen, vom Generator unabhängigen Verfahren. Der Engine-Teil wird unverändert aus
   index.html geladen (zwischen 'use strict' und dem UI-Block).

   Aufruf:  node test/difficulty.mjs                     300 Rätsel je Typ und Stufe
            node test/difficulty.mjs --n 1000            mehr Rätsel
            node test/difficulty.mjs --file alt.html     eine andere Fassung messen (z. B. git show main:index.html > alt.html)
            node test/difficulty.mjs --json out.json     zusätzlich alle Rohwerte
            node test/difficulty.mjs --ref alt.html      Vergleich mit einer älteren Fassung: Dailys der nächsten 60 Tage ab heute
                                                         und alle Rätsel von Normal bis Insane müssen gleich sein

   Kennzahlen je Rätsel:
   raten   Chance, beim ersten Versuch blind zu treffen. Auswahl: 1/Optionen. „Alle wählen“: 1/(2^Optionen − 1).
           Ordnen: 1/n!. Zahleneingabe: Anteil des häufigsten Lösungswerts in Unterart und Stufe (wer immer diese
           Zahl tippt). Matrix zum Einstellen: Raten unter den Werten, die im Raster vorkommen.
           Raster, Gleichung, Logikgitter, Legepuzzle: Lösungen / Suchraum.
   abk     Erfolgschance eines Spielers, der nur eine einfache Abkürzung kennt und sonst rät (bei ANALYZE beschrieben).
   lös     Zahl der gültigen Lösungen. Gleichung: verschieden bis auf Vertauschen und Umklammern.
   raum    log10 des Suchraums.
   schr    Denkschritte: verschiedene Überlegungen, die das Rätsel erzwingt. Logikgitter: Runden eines
           Propagationslösers (+1, wenn eine Fallunterscheidung nötig ist). Sonst aus der Bauart (bei ANALYZE).
   par     Richtzeit des Spiels in Sekunden (60 × rating; in Fassung 1 war es 30 + 14 × rating).
   Prüfungen (unabhängig vom Generator): Eindeutigkeit von Operator und Maschinen per Brute Force über die
   Formelfamilie, Logikgitter per vollständiger Suche, Gleichungen per eigener Aufzählung, Würfelansichten
   über drei Faltverfahren plus ein von Hand hergeleitetes Netz, Mindestzahl aus Ansichten per Suche über
   alle Turmhöhen, Matrix und Malraster per Suche über die ganze Regelfamilie, Symmetrie über alle Kandidaten. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i < 0 ? null : (args[i + 1] ?? true); };
const N = +(opt('--n') || 300), JSON_OUT = opt('--json'), FILE = opt('--file') || join(ROOT, 'index.html'), REF = opt('--ref');
const BUDGET = 150;

/* ---------------------------------------------------------------- Engine laden */
const engine = file => {
  const html = readFileSync(file, 'utf8'), a0 = html.indexOf("'use strict';"), b0 = html.indexOf('/* =====================================================================\n   UI');
  if (a0 < 0 || b0 < 0) throw new Error('Engine-Marker nicht gefunden');
  return new Function(html.slice(a0 + 13, b0) + `\nreturn {${EXPORTS.map(n => `${n}:typeof ${n}==='undefined'?undefined:${n}`).join(',')}};`)();
};
const EXPORTS = ['generate', 'dailyPuzzle', 'DAILY_VERSION', 'TYPE_KEYS', 'DIFF', 'evalTokens', 'fillTpl', 'foldNet', 'foldFrames', 'foldHinge', 'ROT24', 'ROT24B',
  'canonRot', 'pNorm', 'P_ROT', 'P_MIR', 'pKey', 'has2x2', 'pDims', 'ATTR'];
const E = engine(FILE);
const V2 = !!E.foldFrames;

/* ---------------------------------------------------------------- Hilfen */
const log10 = x => Math.log10(Math.max(1, x));
const fact = n => n <= 1 ? 1 : n * fact(n - 1);
const perm = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r *= n - i; return r; };
const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
const f1 = x => Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1)) : '–';
const pc = x => Number.isFinite(x) ? (x > 0 && x < .005 ? '<1' : (x * 100).toFixed(0)) + ' %' : '–';
const checks = {}, bad = [];
const check = (name, ok, info) => { const c = checks[name] ??= { n: 0, bad: 0 }; c.n++; if (!ok) { c.bad++; if (bad.length < 40) bad.push(name + ': ' + info); } };
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };

/* Gleichung: eigene Aufzählung mit evalTokens, eigene Normalform (Summen und Produkte flach und sortiert) */
function canon(tk) {
  let i = 0;
  const fac = () => { const t = tk[i++]; if (t === '(') { const v = ex(); i++; return v; } return { n: t }; };
  const term = () => { const k = [[1, fac()]]; while (tk[i] === '×' || tk[i] === '÷') { const o = tk[i++]; k.push([o === '×' ? 1 : -1, fac()]); } return k.length > 1 ? { t: '*', k } : k[0][1]; };
  const ex = () => { const k = [[1, term()]]; while (tk[i] === '+' || tk[i] === '−') { const o = tk[i++]; k.push([o === '+' ? 1 : -1, term()]); } return k.length > 1 ? { t: '+', k } : k[0][1]; };
  const s = x => { if (x.n != null) return '' + x.n; const out = []; const walk = (k, g) => k.forEach(([e, c]) => c.t === x.t ? walk(c.k, g * e) : out.push((g * e > 0 ? 'p' : 'm') + s(c))); walk(x.k, 1); return x.t + '{' + out.sort().join(',') + '}'; };
  return s(ex());
}
function eqCount(tpl, nums, ops, target, cap = 50) {
  const nN = tpl.filter(x => x === 'N').length, nO = tpl.filter(x => x === 'O').length, seen = new Set();
  const pick = (pool, k) => { const out = []; (function r(cur, used) { if (cur.length === k) { out.push(cur.slice()); return; } const t = new Set(); pool.forEach((v, i) => { if (used[i] || t.has(v)) return; t.add(v); used[i] = 1; cur.push(v); r(cur, used); cur.pop(); used[i] = 0; }); })([], pool.map(() => 0)); return out; };
  const NS = pick(nums, nN), OS = pick(ops, nO);
  for (const ns of NS) for (const os of OS) {
    let a = 0, b = 0; const tk = tpl.map(t => t === 'N' ? ns[a++] : t === 'O' ? os[b++] : t);
    if (Math.abs(E.evalTokens(tk) - target) < 1e-9) { seen.add(canon(tk)); if (seen.size >= cap) return { sols: seen.size, space: NS.length * OS.length }; }
  }
  return { sols: seen.size, space: NS.length * OS.length };
}

/* Geheimoperator: Brute Force über die genannte Familie p·a + q·b (+ r·a·b) + s in einem großen Bereich */
function opBrute(p) {
  const full = p.rules.some(r => r.includes('r × a × b')), v = p.view, num = t => t === 'x' ? 'x' : +t;
  const rows = v.rows.map(([l, r]) => [...l.split(' ◇ ').map(num), +r]);
  const q = v.q.split(' ◇ ').map(t => t === '?' ? '?' : num(t)), res = v.res != null ? +v.res : null;
  const hasX = rows.some(r => r.includes('x')) || q.includes('x');
  const answers = new Set(), R = full ? 6 : 0;
  for (let pp = -6; pp <= 6; pp++) for (let qq = -6; qq <= 6; qq++) for (let rr = -R; rr <= R; rr++) for (let s = -25; s <= 25; s++) {
    const f = (a, b) => pp * a + qq * b + rr * a * b + s;
    if (!rows.every(r => r.includes('x') || f(r[0], r[1]) === r[2])) continue;
    for (const x of hasX ? Array.from({ length: 20 }, (_, i) => i + 1) : [0]) {
      const val = t => t === 'x' ? x : t;
      if (!rows.every(r => f(val(r[0]), val(r[1])) === r[2])) continue;
      if (res == null) answers.add(f(val(q[0]), val(q[1])));
      else for (let y = -60; y <= 60; y++) if (f(q[0] === '?' ? y : val(q[0]), q[1] === '?' ? y : val(q[1])) === res) answers.add(y);
    }
  }
  return answers;
}
/* Maschinen: Brute Force über a·x + b (a ≠ 0) für jede Maschine */
function chainBrute(p) {
  const out = new Set(), rows = p.view.rows, L = [];
  for (let a = -12; a <= 12; a++) if (a) for (let b = -60; b <= 60; b++) L.push([a, b]);
  const As = L.filter(([a, b]) => rows.every(r => r[0] == null || r[1] == null || a * r[0] + b === r[1]));
  for (const [a, b] of As) for (const [c, d] of L) if (rows.every(r => (r[1] == null || r[2] == null || c * r[1] + d === r[2]) && (r[0] == null || r[2] == null || c * (a * r[0] + b) + d === r[2]))) out.add(c * (a * p.view.q + b) + d);
  return out;
}

/* Logikgitter: Hinweise zurückübersetzen, vollständige Suche und menschenähnlicher Propagationslöser */
const SH = ['Kreis', 'Dreieck', 'Quadrat', 'Raute', 'Sechseck'], CO = ['cyan', 'violett', 'magenta', 'gelb', 'weiß'];
const CO_ADJ = ['cyanfarbene', 'violette', 'magentafarbene', 'gelbe', 'weiße'], CO_DAT = ['cyanfarbenen', 'violetten', 'magentafarbenen', 'gelben', 'weißen'];
function logicParse(p) {
  const v = p.view, items = [];
  v.shapes.forEach((s, i) => items.push({ cat: 0, names: [SH[s]] }));
  if (v.cats === 2) v.colors.forEach(c => items.push({ cat: 1, names: [CO_ADJ[c] + ' Form', CO_DAT[c] + ' Form'], col: CO[c] }));
  const find = s => { s = s.replace(/^(Der|Die|Das|dem|der|vom) /, ''); return items.findIndex(it => it.names.includes(s)); };
  const C = [];
  for (const t of v.clues) {
    let m;
    if ((m = t.match(/^Zwischen (.*) und (.*) steht genau eine Form\.$/))) C.push({ ty: 'gap', x: find(m[1]), y: find(m[2]) });
    else if ((m = t.match(/^(.*) ist (nicht )?(\S+)\.$/))) C.push({ ty: m[2] ? 'ns' : 'same', x: find(m[1]), y: items.findIndex(it => it.col === m[3]) });
    else if ((m = t.match(/^(.*) steht (nicht )?auf Platz (\d)\.$/))) C.push({ ty: m[2] ? 'na' : 'at', x: find(m[1]), p: +m[3] - 1 });
    else if ((m = t.match(/^(.*) steht (nicht )?am Rand\.$/))) C.push({ ty: m[2] ? 'nedge' : 'edge', x: find(m[1]) });
    else if ((m = t.match(/^(.*) steht irgendwo links (?:von|vom) (.*)\.$/))) C.push({ ty: 'lo', x: find(m[1]), y: find(m[2]) });
    else if ((m = t.match(/^(.*) steht direkt links (?:von|vom) (.*)\.$/))) C.push({ ty: 'dl', x: find(m[1]), y: find(m[2]) });
    else if ((m = t.match(/^(.*) steht irgendwo rechts (?:von|vom) (.*)\.$/))) C.push({ ty: 'lo', x: find(m[2]), y: find(m[1]) });
    else if ((m = t.match(/^(.*) steht direkt rechts (?:von|vom) (.*)\.$/))) C.push({ ty: 'dl', x: find(m[2]), y: find(m[1]) });
    else if ((m = t.match(/^(.*) steht (nicht )?direkt neben (.*)\.$/))) C.push({ ty: m[2] ? 'nadj' : 'adj', x: find(m[1]), y: find(m[3]) });
    else throw new Error('Hinweis nicht verstanden: ' + t);
  }
  if (C.some(c => c.x < 0 || c.y < 0)) throw new Error('Name nicht gefunden: ' + v.clues.join(' / '));
  return { items, C, Nn: v.N };
}
const LU = (c, q, Nn) => c.ty === 'at' ? q === c.p : c.ty === 'na' ? q !== c.p : c.ty === 'edge' ? (q === 0 || q === Nn - 1) : c.ty === 'nedge' ? !(q === 0 || q === Nn - 1) : true;
const LB = (c, q, r) => c.ty === 'same' ? q === r : c.ty === 'ns' ? q !== r : c.ty === 'lo' ? q < r : c.ty === 'dl' ? r - q === 1 : c.ty === 'adj' ? Math.abs(q - r) === 1 : c.ty === 'nadj' ? Math.abs(q - r) > 1 : c.ty === 'gap' ? Math.abs(q - r) === 2 : true;
function logicCount({ items, C, Nn }) {
  const P = []; (function r(a, rest) { if (!rest.length) { P.push(a); return; } rest.forEach((x, i) => r(a.concat(x), rest.slice(0, i).concat(rest.slice(i + 1)))); })([], [...Array(Nn).keys()]);
  const two = items.some(i => i.cat === 1); let n = 0;
  for (const S of P) for (const Cc of two ? P : [null]) {
    const pos = k => items[k].cat ? Cc[k - Nn] : S[k];
    if (C.every(c => c.y === undefined ? LU(c, pos(c.x), Nn) : LB(c, pos(c.x), pos(c.y)))) n++;
  }
  return n;
}
function logicSolve({ items, C, Nn }) {
  const dom = items.map(() => new Set([...Array(Nn).keys()]));
  let rounds = 0; const done = () => dom.every(d => d.size === 1);
  while (!done()) {                              // Runde auf dem Stand vom Rundenbeginn (unabhängig von der Reihenfolge der Hinweise)
    rounds++; const old = dom.map(d => new Set(d)), next = dom.map(d => new Set(d));
    for (const c of C) {
      if (c.y === undefined) { for (const q of old[c.x]) if (!LU(c, q, Nn)) next[c.x].delete(q); continue; }
      const same = items[c.x].cat === items[c.y].cat;
      for (const q of old[c.x]) if (![...old[c.y]].some(r => (!same || r !== q) && LB(c, q, r))) next[c.x].delete(q);
      for (const r of old[c.y]) if (![...old[c.x]].some(q => (!same || r !== q) && LB(c, q, r))) next[c.y].delete(r);
    }
    for (const cat of [0, 1]) {
      const its = items.map((it, k) => k).filter(k => items[k].cat === cat); if (!its.length) continue;
      for (const k of its) if (old[k].size === 1) { const q = [...old[k]][0]; for (const o of its) if (o !== k) next[o].delete(q); }
      for (let q = 0; q < Nn; q++) { const hs = its.filter(k => old[k].has(q)); if (hs.length === 1 && old[hs[0]].size > 1) next[hs[0]] = new Set([q]); }
    }
    const ch = next.some((d, k) => d.size !== old[k].size); next.forEach((d, k) => dom[k] = d);
    if (!ch || dom.some(d => !d.size)) break;
  }
  return { rounds, stuck: !done(), direct: C.filter(c => c.ty === 'at').length };
}

/* Legepuzzle: Zerlegungen zählen (nur Drehen) */
function assembleCount(p, cap = 5000, fixed = false) {
  const tg = new Set(p.view.target.map(([x, y]) => x + ',' + y)), cells = p.view.target.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const rots = p.view.pieces.map(pc => { const out = [], seen = new Set(); let c = pc.cells.map(q => [q[0], q[1], 0]);
    for (let r = 0; r < (fixed ? 1 : 4); r++) { const n = E.pNorm(c), k = E.pKey(n); if (!seen.has(k)) { seen.add(k); out.push(n.map(q => [q[0], q[1]])); } c = E.P_ROT(c); } return out; });
  const key = p.view.pieces.map(pc => (fixed ? E.pKey : E.canonRot)(pc.cells.map(q => [q[0], q[1], 0])));
  let place = 1; rots.forEach(rs => { let n = 0; rs.forEach(r => cells.forEach(([x, y]) => { if (r.every(([a, b]) => tg.has((a + x) + ',' + (b + y)))) n++; })); place *= Math.max(1, n); });
  const used = rots.map(() => false), filled = new Set(); let count = 0;
  (function rec() {
    if (count >= cap) return;
    const first = cells.find(([x, y]) => !filled.has(x + ',' + y)); if (!first) { count++; return; }
    for (let i = 0; i < rots.length; i++) {
      if (used[i] || key.some((k, j) => j < i && !used[j] && k === key[i])) continue;
      for (const r of rots[i]) { const dx = first[0] - r[0][0], dy = first[1] - r[0][1], ks = r.map(([a, b]) => (a + dx) + ',' + (b + dy));
        if (!ks.every(k => tg.has(k) && !filled.has(k))) continue; used[i] = true; ks.forEach(k => filled.add(k)); rec(); ks.forEach(k => filled.delete(k)); used[i] = false; }
    }
  })();
  return { count, space: place };
}

/* Symmetrie ohne Achse: eigene Gruppen, alle Kandidaten */
const GRP = n => { const m = { V: (r, c) => [r, n - 1 - c], H: (r, c) => [n - 1 - r, c], R2: (r, c) => [n - 1 - r, n - 1 - c], D1: (r, c) => [c, r], D2: (r, c) => [n - 1 - c, n - 1 - r], R90: (r, c) => [c, n - 1 - r], R270: (r, c) => [n - 1 - c, r] };
  return { V: [m.V], H: [m.H], D1: [m.D1], D2: [m.D2], R2: [m.R2], R4: [m.R90, m.R2, m.R270], VH: [m.V, m.H, m.R2], DD: [m.D1, m.D2, m.R2], D4: Object.values(m) }; };
function symHiddenCheck(p) {
  const v = p.view, n = v.n, G = GRP(n), given = new Set(v.given), sol = new Set(p.solution);
  const cands = p.prompt.includes('doppelt') ? ['VH', 'DD', 'D4'] : p.prompt.includes('Diagonale') ? ['V', 'H', 'D1', 'D2', 'R2', 'R4'] : ['V', 'H'];
  const answers = new Set();
  for (const g of cands) {
    const cl = new Set(); given.forEach(i => { cl.add(i); G[g].forEach(f => { const [r, c] = f(Math.floor(i / n), i % n); cl.add(r * n + c); }); });
    const need = cl.size - given.size;
    if (need < v.K) return { ok: false, why: `${g} bräuchte nur ${need}` };
    if (need === v.K) answers.add([...cl].filter(i => !given.has(i)).sort((a, b) => a - b).join());
  }
  return { ok: answers.size === 1 && [...answers][0] === [...sol].sort((a, b) => a - b).join(), why: [...answers].join(' / ') };
}
/* Matrix: Suche über alle Raster der Regelfamilie je Eigenschaft */
function matrixCheck(p) {
  const v = p.view, keys = ['s', 'c', 'n', 'f'], holes = v.holes;
  return keys.every(a => {
    const dom = [...Array(E.ATTR[a].n).keys()], preds = new Set(), grids = [];
    for (const x of dom) for (const y of dom) for (const z of dom) { grids.push(i => [x, y, z][Math.floor(i / 3)]); grids.push(i => [x, y, z][i % 3]); }
    for (const x of dom) for (const y of dom) for (const z of dom) if (x !== y && y !== z && x !== z) for (const k of [1, 2]) grids.push(i => [x, y, z][(Math.floor(i / 3) + k * (i % 3)) % 3]);
    for (const g of grids) if ([...Array(9).keys()].every(i => holes.includes(i) || g(i) === v.cells[i][a])) preds.add(holes.map(g).join());
    return preds.size === 1 && [...preds][0] === p.solution.map(o => o[a]).join();
  });
}
/* Malraster mit Verschiebung: Suche über s, c und die erste Zeile (mit Rückverfolgung) */
function shiftCheck(p) {
  const v = p.view, n = v.n, k = v.k, step = !!v.order, answers = new Set();
  for (let s = 0; s < n; s++) for (let c = 0; c < (step ? k : 1); c++) {
    const row = Array(n).fill(-1);
    const cellOK = i => { const r = Math.floor(i / n), col = i % n, src = ((col - r * s) % n + n) % n; return row[src] < 0 || (row[src] + r * c) % k === v.grid[i]; };
    (function rec(j) {
      if (answers.size > 1) return;
      if (j === n) { answers.add(v.miss.map(i => { const r = Math.floor(i / n), src = ((i % n - r * s) % n + n) % n; return (row[src] + r * c) % k; }).join()); return; }
      for (let x = 0; x < k; x++) { row[j] = x; if (v.grid.every((g, i) => g < 0 || cellOK(i))) rec(j + 1); }
      row[j] = -1;
    })(0);
  }
  return answers.size === 1 && [...answers][0] === p.solution.join();
}
/* Ansichten: Suche über alle Turmhöhen bis min(vorn, rechts) */
function viewsBrute(v) {
  const cells = []; for (let i = 0; i < v.W; i++) for (let j = 0; j < v.D; j++) cells.push([i, j, Math.min(v.F[i], v.S[j])]);
  const sizes = cells.map(c => c[2] + 1); if (sizes.reduce((a, b) => a * b, 1) > 3e6) return null;
  const h = cells.map(() => 0); let best = Infinity;
  (function rec(k, sum) {
    if (sum >= best) return;
    if (k === cells.length) {
      const F = Array(v.W).fill(0), S = Array(v.D).fill(0);
      cells.forEach(([i, j], t) => { F[i] = Math.max(F[i], h[t]); S[j] = Math.max(S[j], h[t]); });
      if (F.every((x, i) => x === v.F[i]) && S.every((x, j) => x === v.S[j])) best = sum; return;
    }
    const [i, j, m] = cells[k], occ = v.T ? v.T[i][j] : null;
    for (let z = occ === 0 ? 0 : occ === 1 ? 1 : 0; z <= (occ === 0 ? 0 : m); z++) { h[k] = z; rec(k + 1, sum + z); }
  })(0, 0);
  return best;
}
/* Würfelansichten: drei Faltverfahren gegeneinander, dazu ein von Hand hergeleitetes Kreuznetz */
const vk = v => v.join(',');
function viewSet(faces, rots) { const s = new Set(); for (const Q of rots) { const f = [[0, 0, 1], [0, 1, 0], [1, 0, 0]].map(w => faces.findIndex(x => vk(Q(x.n)) === vk(w))); s.add(f.join(':') + (faces[0].a ? '|' + f.map(i => vk(Q(faces[i].a))).join('/') : '')); } return s; }
function cviewCheck(p) {
  const v = p.view, net = v.net, lab = E.foldNet(net), NR = [[0, 0, -1], [0, 0, 1], [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0]];
  const fr = E.foldFrames(net), hg = E.foldHinge(net, v.arr);
  const normalsAgree = net.every((c, i) => vk(NR[lab[i]]) === vk(fr[i].n) && vk(fr[i].n) === vk(hg[i].n));
  const A = viewSet(fr.map((f, i) => ({ n: f.n, a: v.arr ? [0, 1, 2].map(k => v.arr[i][0] * f.ex[k] + v.arr[i][1] * f.ey[k]) : null })), E.ROT24B), B = viewSet(hg, E.ROT24);
  const same = A.size === 24 && B.size === 24 && [...A].every(x => B.has(x));
  const optsOK = v.opts.every((o, k) => B.has(o.f.join(':') + (o.a ? '|' + o.a.map(vk).join('/') : '')) === p.solution.includes(k));
  return { normalsAgree, same, optsOK };
}
function handCross() {        // Kreuz: Mitte (1,1) oben, (1,2) faltet nach vorn (+y), (2,1) nach rechts (+x). Farben außen.
  const net = [[1, 1], [1, 0], [0, 1], [2, 1], [1, 2], [1, 3]], fr = E.foldFrames(net), B = viewSet(E.foldHinge(net, null), E.ROT24), A = viewSet(fr.map(f => ({ n: f.n, a: null })), E.ROT24B);
  return B.has('0:4:3') && !B.has('0:3:4') && A.has('0:4:3') && vk(fr[5].n) === '0,0,-1';
}

/* ---------------------------------------------------------------- Easy: ablesbar und Abkürzung
   „ablesbar“ heißt: Die Lösung folgt ohne echten Schluss, nur durch Abschreiben, Abzählen oder einen festen Abstand.
   Die Festlegung je Unterart steht bei ANALYZE (read). Alles wird aus der Ansicht berechnet, nicht aus dem Generator. */
const polyA = p => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;
function eqAny(tpl, nums, ops, target, pred) {       // gibt es eine Lösung, deren Rechenzeichen pred erfüllen?
  const nN = tpl.filter(x => x === 'N').length, nO = tpl.filter(x => x === 'O').length;
  const pick = (pool, k) => { const out = []; (function r(cur, used) { if (cur.length === k) { out.push(cur.slice()); return; } pool.forEach((v, i) => { if (used[i]) return; used[i] = 1; cur.push(v); r(cur, used); cur.pop(); used[i] = 0; }); })([], pool.map(() => 0)); return out; };
  const OS = pick(ops, nO).filter(pred); if (!OS.length) return false;
  for (const ns of pick(nums, nN)) for (const os of OS) { let a = 0, b = 0; if (Math.abs(E.evalTokens(tpl.map(t => t === 'N' ? ns[a++] : t === 'O' ? os[b++] : t)) - target) < 1e-9) return true; }
  return false;
}
function logicRead({ items, C, Nn }) {               // nur „steht auf Platz“ und „der letzte freie Platz“: löst das allein?
  const pos = items.map(() => -1);
  C.forEach(c => { if (c.ty === 'at') pos[c.x] = c.p; });
  for (let ch = true; ch;) { ch = false; for (const cat of [0, 1]) { const its = items.map((it, k) => k).filter(k => items[k].cat === cat), open = its.filter(k => pos[k] < 0);
    if (open.length === 1) { const used = its.map(k => pos[k]); pos[open[0]] = [...Array(Nn).keys()].find(q => !used.includes(q)); ch = true; } } }
  return pos.every(q => q >= 0);
}
function logicMention(p) {                           // Blick-Trick: Platzangaben übernehmen, Rest in der Reihenfolge der ersten Erwähnung
  const v = p.view, P = logicParse(p), at = Array(v.N).fill(-1);
  P.C.forEach(c => { if (c.ty === 'at' && P.items[c.x].cat === 0) at[c.p] = c.x; });
  const order = []; v.clues.forEach(t => SH.map((n, i) => [t.indexOf(n), i]).filter(([k]) => k >= 0).sort((a, b) => a[0] - b[0]).forEach(([, i]) => { const k = v.shapes.indexOf(i); if (k >= 0 && !order.includes(k)) order.push(k); }));
  v.shapes.forEach((s, k) => { if (!order.includes(k)) order.push(k); });
  const rest = order.filter(k => !at.includes(k)); return at.map(k => k >= 0 ? k : rest.shift()).join() === p.solution.s.join() ? 1 : 0;
}
function symSides(v) {                               // Spiegelpartner je Feld und Seite (Index kleiner als der des Partners)
  const n = v.n, f = GRP(n)[v.type][0];
  return i => { const [r, c] = f(Math.floor(i / n), i % n), j = r * n + c; return j === i ? 0 : i < j ? 1 : 2; };
}

/* ---------------------------------------------------------------- Analyse je Unterart */
const two = n => 1 / (Math.pow(2, n) - 1);
const bboxA = poly => { const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]); return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)); };
const lineRun = (cells, len) => { const s = new Set(cells.map(c => c[0] + ',' + c[1])); return cells.some(([x, y]) => [[1, 0], [0, 1]].some(([dx, dy]) => { for (let i = 1; i < len; i++) if (!s.has((x + dx * i) + ',' + (y + dy * i))) return false; return true; })); };
const diffOrder = t => { let d = t.slice(); for (let k = 1; k <= 3; k++) { d = d.slice(1).map((x, i) => x - d[i]); if (d.length >= 2 && d.every(x => x === d[0])) return k; } return 0; };
const ANALYZE = {
  // Folge. abk: jede Lücke linear aus den beiden Nachbarn fortsetzen. schr: 1 bei gleichem Abstand und einer Lücke, sonst 2.
  seq(p) {
    const sol = [].concat(p.solution), gaps = p.view.terms.map((x, i) => x == null ? i : -1).filter(i => i >= 0), t = p.view.terms.slice(); gaps.forEach((g, k) => t[g] = sol[k]);
    const pred = gaps.map(g => g >= 2 && !gaps.includes(g - 1) && !gaps.includes(g - 2) ? 2 * t[g - 1] - t[g - 2] : g + 2 < t.length && !gaps.includes(g + 1) && !gaps.includes(g + 2) ? 2 * t[g + 1] - t[g + 2] : null);
    const o = diffOrder(t);
    return { short: pred.every((x, k) => x === sol[k]) ? 1 : 0, read: o === 1 ? 1 : 0, steps: o === 1 && gaps.length === 1 ? 1 : 2, sols: 1, num: true, tag: gaps.length + ' Lücke' + (gaps.length > 1 ? 'n' : '') };
  },
  // Maschine (nur Easy). ablesbar: reines Vielfaches (eine Zeile verrät die Regel). abk: Ausgabespalte wie eine Folge fortsetzen.
  machine(p) {
    const r = p.view.rows.map(([x, y]) => [+x, +y]), k = r[0][1] / r[0][0], L = r.length;
    return { steps: 1, sols: 1, num: true, read: r.every(([x, y]) => y === k * x) ? 1 : 0, short: 2 * r[L - 1][1] - r[L - 2][1] === p.solution ? 1 : 0 };
  },
  // Zwei Maschinen: jede einzeln bestimmen, dann anwenden (2). lös: Brute Force über beide Familien.
  chain(p) { const s = chainBrute(p); check('Maschinen eindeutig (Brute Force)', s.size === 1 && s.has(p.solution), [...s].join(',')); return { steps: 2, sols: s.size, num: true }; },
  // Geheimoperator. schr: Normal 2 (drei Unbekannte), Hard 2–3 (Produktglied, Rückwärtsfrage), Insane 3 (Regel, x, Frage).
  op(p) {
    const v = p.view, mode = v.res != null ? 'rückwärts' : (v.q + v.rows.map(r => r[0]).join()).includes('x') ? 'mit x' : 'vorwärts';
    let sols = 1;
    if (V2) { const s = opBrute(p); sols = s.size; check('Operator eindeutig (Brute Force über die Familie)', s.size === 1 && s.has(p.solution), mode + ' ' + [...s].slice(0, 5).join(',')); }
    const full = p.rules.some(r => r.includes('r × a × b'));
    return { steps: mode === 'mit x' ? 3 : full ? (mode === 'rückwärts' ? 3 : 2) : V2 ? 2 : 1, sols, num: true, tag: mode };
  },
  riddle(p) { const three = p.prompt.includes('dreistellige'); return { steps: p.view.lines.length, sols: 1, num: true, space: log10(three ? 900 : 90) }; },
  // Würfelbau. Easy: ablesbar und abk = jeder Würfel ist zu sehen (nur abzählen). Verdeckt ist ein Würfel, wenn über ihm einer liegt
  // und beide vorderen Nachbartürme mindestens bis zu seiner Höhe reichen.
  cubes(p) {
    const mode = p.sig.split(':')[1], h = p.view.h, W = h.length, D = h[0].length; let hid = 0;
    for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) for (let z = 0; z < h[i][j] - 1; z++) if (i + 1 < W && h[i + 1][j] > z && j + 1 < D && h[i][j + 1] > z) hid++;
    return { steps: mode === 'count' ? 1 : 2, sols: 1, num: true, tag: mode, read: mode === 'count' && !hid ? 1 : 0, short: mode === 'count' && !hid ? 1 : 0 };
  },
  // Mindestzahl aus Ansichten: Säulen je Höhe zuordnen (2), mit Draufsicht zusätzlich Bodenfelder (3).
  views(p) { const b = viewsBrute(p.view); if (b != null) check('Ansichten: Minimum per Suche über alle Höhen', b === p.solution, b + ' statt ' + p.solution); return { steps: p.view.T ? 3 : 2, sols: 1, num: true, tag: p.view.T ? '3 Ansichten' : '2 Ansichten' }; },
  build(p) { return ANALYZE._eq(p); },
  fusion(p) { const r = ANALYZE._eq(p); r.steps += 1; r.tag = (p.fusion === 'Spatial Logic' ? 'Würfel' : 'Folge') + ' · ' + r.tag; return r; },
  // Gleichung. lös: eigene Aufzählung. schr: 1 bei bis zu 3 Zahlen, 2 ab 4 Zahlen, 3 bei 5 Zahlen und genau einer Lösung.
  _eq(p) {
    const v = p.view, nN = v.tpl.filter(x => x === 'N').length, r = eqCount(v.tpl, v.nums, v.ops, v.target);
    check('Gleichung: gespeicherte Lösung gültig', p.validate(p.solution) === true, p.sig);
    const out = { steps: nN >= 5 && r.sols === 1 ? 3 : nN >= 4 ? 2 : 1, sols: r.sols, space: log10(r.space), guess: r.sols / r.space, tag: nN + ' Zahlen' };
    if (p.diff === 0 && p.sub === 'build') {          // ablesbar: eine Lösung mit nur einer Sorte Rechenzeichen. abk: nur addieren.
      out.read = eqAny(v.tpl, v.nums, v.ops, v.target, os => new Set(os).size === 1) ? 1 : 0; out.short = eqAny(v.tpl, v.nums, v.ops, v.target, os => os.every(o => o === '+')) ? 1 : 0; }
    return out;
  },
  // Netz, Gegenüber (nur Easy). abk: zwei Felder weiter in gerader Reihe, sonst raten.
  netopp(p) {
    const c = p.view.cells, m = c[p.view.mark], at = (x, y) => c.findIndex(q => q[0] === x && q[1] === y), hits = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const mid = at(m[0] + dx, m[1] + dy), far = at(m[0] + 2 * dx, m[1] + 2 * dy); if (mid >= 0 && far >= 0) hits.push(far); }
    const read = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(m[0] + dx, m[1] + dy) >= 0 && at(m[0] + 2 * dx, m[1] + 2 * dy) === p.solution) ? 1 : 0;   // ablesbar: eine Fläche dazwischen, gerade Reihe
    return { guess: .2, short: hits.length === 1 ? (hits[0] === p.solution ? 1 : 0) : .2, read, steps: hits.length === 1 ? 1 : 2, sols: 1, space: log10(5) };
  },
  // Faltbare Netze. abk: Netze mit sichtbarem Fehler (2×2-Block, fünf in einer Reihe) aussortieren.
  netvalid(p) {
    const o = p.view.opts, defect = o.map(c => E.has2x2(c) || lineRun(c, 5));
    if (p.kind === 'multi') { const pick = o.map((c, i) => i).filter(i => !defect[i]); const hit = pick.join() === p.solution.join();
      return { guess: two(o.length), short: hit ? 1 : 0, steps: hit ? 1 : 2, sols: 1, space: log10(Math.pow(2, o.length) - 1), tag: 'alle wählen' }; }
    const want = p.prompt.startsWith('Nur eines'); let short;
    if (want) { const rest = o.map((c, i) => i).filter(i => !defect[i]); short = rest.includes(p.solution) ? 1 / rest.length : 0; }
    else { const def = o.map((c, i) => i).filter(i => defect[i]); short = def.length ? (def.includes(p.solution) ? 1 / def.length : 0) : 1 / o.length; }
    return { guess: 1 / o.length, short, steps: 2, sols: 1, space: log10(o.length), tag: 'eine aus vier' };
  },
  // Drehfigur. abk: nur den Umriss vergleichen (Markierungen ignorieren).
  rotate(p) {
    const strip = c => E.canonRot(c.map(q => [q[0], q[1], 0])), ref = strip(p.view.ref), o = p.view.opts, same = o.map((c, i) => strip(c) === ref ? i : -1).filter(i => i >= 0);
    if (p.kind === 'multi') { const hit = same.join() === p.solution.join(); return { guess: two(o.length), short: hit ? 1 : 0, steps: 2, sols: 1, space: log10(Math.pow(2, o.length) - 1), tag: 'alle wählen' }; }
    return { guess: 1 / o.length, short: same.includes(p.solution) ? 1 / same.length : 0, read: same.length === 1 && same[0] === p.solution ? 1 : 0, steps: same.length > 1 ? 2 : 1, sols: 1, space: log10(o.length), tag: 'eine aus vier' };
  },
  // Würfelansichten. abk: nur „keine gegenüberliegenden Flächen“ prüfen (ohne Drehrichtung) und alle übrigen wählen.
  cview(p) {
    const c = cviewCheck(p), lab = E.foldNet(p.view.net), opp = (x, y) => lab[x] === (lab[y] ^ 1);
    check('Würfelansichten: Normalen aus drei Faltverfahren gleich', c.normalsAgree, p.sig); check('Würfelansichten: 24 Lagen aus zwei Verfahren gleich', c.same, p.sig); check('Würfelansichten: jede Option einzeln richtig bewertet', c.optsOK, p.sig);
    const pick = p.view.opts.map((o, i) => [[0, 1], [1, 2], [0, 2]].some(([x, y]) => opp(o.f[x], o.f[y])) ? -1 : i).filter(i => i >= 0);
    return { guess: two(p.view.opts.length), short: pick.join() === p.solution.join() ? 1 : 0, steps: p.view.arr ? 3 : 2, sols: 1, space: log10(31), tag: p.view.arr ? 'mit Pfeilen' : 'Farben' };
  },
  // Flächen. Auswahl: größte Umrandung. Ordnen: nach Umrandung ordnen. Alle gleich großen: gleiche Umrandung wie die Vorlage.
  area(p) {
    const o = p.view.opts, bx = o.map(bboxA);
    if (p.kind === 'order') { const ord = o.map((x, i) => i).sort((a, b) => bx[a] - bx[b] || a - b); return { guess: 1 / fact(o.length), short: ord.join() === p.solution.join() ? 1 : 0, steps: 2, sols: 1, space: log10(fact(o.length)), tag: 'ordnen' }; }
    if (p.kind === 'multi') { const rb = bboxA(p.view.ref), pick = bx.map((x, i) => x === rb ? i : -1).filter(i => i >= 0); return { guess: two(o.length), short: pick.join() === p.solution.join() ? 1 : 0, steps: 2, sols: 1, space: log10(63), tag: 'alle gleich großen' }; }
    const mode = p.prompt.includes('größte') ? 'max' : p.prompt.includes('kleinste') ? 'min' : 'equal';
    const best = mode === 'min' ? Math.min(...bx) : Math.max(...bx), top = bx.map((x, i) => x === best ? i : -1).filter(i => i >= 0);
    const ar = polyA(o[p.solution]), read = mode === 'max' && o.every((x, i) => i === p.solution || bx[i] < ar) ? 1 : 0;   // ablesbar: größer als jede andere Umrandung
    return { guess: 1 / o.length, short: mode === 'equal' ? 1 / o.length : top.includes(p.solution) ? 1 / top.length : 0, read, steps: 1, sols: 1, space: log10(o.length), tag: mode };
  },
  // Polygonfläche: Rechteck minus Ecken oder Zerlegen (2).
  poly(p) { return { steps: 2, sols: 1, num: true }; },
  assemble(p) {
    const { count, space } = assembleCount(p); if (p.diff > 0 && V2) check('Legepuzzle: höchstens 2 Zerlegungen (Insane: 4) ab Normal', count <= (p.diff === 3 ? 4 : 2), count + ' ' + p.sig);
    const plain = p.diff === 0 ? (assembleCount(p, 1, true).count ? 1 : 0) : 0;      // ablesbar und abk: alle Teile passen so, wie sie liegen (ohne Drehen)
    return { guess: count / space, read: plain, short: plain, steps: p.view.pieces.length > 3 ? 2 : 1, sols: count, space: log10(space), tag: p.view.pieces.length + ' Teile' };
  },
  // Symmetrie. Mit Achse: eine Regel (1). Ohne Achse: Achse finden, dann ergänzen (2); doppelt: 3.
  sym(p) {
    const v = p.view, free = v.n * v.n - v.given.length;
    if (v.hidden) { const c = symHiddenCheck(p); check('Symmetrie ohne Achse eindeutig (alle Kandidaten)', c.ok, c.why); }
    let read, short;
    if (!v.hidden && GRP(v.n)[v.type].length === 1) {  // eine Achse sichtbar. ablesbar: alle Vorgaben auf einer Seite, alles Fehlende auf der anderen (Halbbild spiegeln).
      const side = symSides(v), gs = new Set(v.given.map(side)), ms = new Set(p.solution.map(side)); gs.delete(0); ms.delete(0);
      short = ms.size === 1 ? 1 : 0; read = short && gs.size === 1 && !ms.has([...gs][0]) ? 1 : 0;   // abk: die vollere Seite auf die leere spiegeln
    }
    return { guess: 0, read, short, steps: v.hidden ? (p.prompt.includes('doppelt') ? 3 : 2) : 1, sols: 1, space: free * Math.log10(2), tag: v.hidden ? 'ohne Achse' : 'Achse sichtbar' };
  },
  // Matrix. Auswahl: abk = Mehrheitsoption. Einstellen: raten unter den vorkommenden Werten. schr: veränderliche Eigenschaften.
  matrix(p) {
    const keys = ['s', 'c', 'n', 'f'], nv = keys.filter(k => new Set(p.view.cells.map(c => c[k])).size > 1).length;
    if (p.kind === 'build') {
      check('Matrix eindeutig (Suche über die Regelfamilie)', matrixCheck(p), p.sig);
      const g = Math.pow(keys.reduce((s, k) => s * new Set(p.view.cells.filter((c, i) => !p.view.holes.includes(i)).map(c => c[k])).size, 1), -p.view.holes.length);
      return { guess: g, steps: nv, sols: 1, space: log10(Math.pow(5 * 4 * 3 * 3, p.view.holes.length)), tag: p.view.holes.length + ' Lücke' + (p.view.holes.length > 1 ? 'n' : '') };
    }
    const o = p.view.opts, sc = o.map(x => keys.reduce((s, k) => s + o.filter(q => q[k] === x[k]).length, 0)), mx = Math.max(...sc), top = sc.map((s, i) => s === mx ? i : -1).filter(i => i >= 0);
    const ms = p.view.miss, nb = [ms % 3 ? ms - 1 : -1, ms % 3 < 2 ? ms + 1 : -1, ms - 3, ms + 3].filter(i => i >= 0 && i < 9), ans = o[p.solution];
    const read = nb.some(i => keys.every(k => p.view.cells[i][k] === ans[k])) ? 1 : 0;            // ablesbar: Nachbarfeld abschreiben
    return { guess: 1 / o.length, short: top.includes(p.solution) ? 1 / top.length : 0, read, steps: nv, sols: 1, space: log10(o.length), tag: 'Auswahl' };
  },
  // Malraster. Mit Verschiebung: Verschiebung (und Farbschritt) finden, dann übertragen (2, mit Farbschritt 3).
  paint(p) {
    const v = p.view;
    const shift = p.sig.startsWith('ps:'); if (shift) check('Malraster eindeutig (Suche über s, c und erste Zeile)', shiftCheck(p), p.sig);
    let read, short;
    if (!shift) {                                    // ablesbar: jede Lücke liegt zwischen zwei gleichfarbigen sichtbaren Nachbarn (Zeile oder Spalte), oder Schachbrett
      const n = v.n, g = (r, c) => r < 0 || c < 0 || r >= n || c >= n ? -1 : v.grid[r * n + c], sol = p.solution;
      const sandw = v.miss.every((i, k) => { const r = Math.floor(i / n), c = i % n; return [[0, 1], [1, 0]].some(([a, b]) => g(r - a, c - b) === sol[k] && g(r + a, c + b) === sol[k]); });
      let chess = v.k === 2; for (let i = 0; i < n * n && chess; i++) { const r = Math.floor(i / n), c = i % n; if (v.grid[i] >= 0 && ((g(r, c + 1) >= 0 && g(r, c + 1) === v.grid[i]) || (g(r + 1, c) >= 0 && g(r + 1, c) === v.grid[i]))) chess = false; }
      read = sandw || chess ? 1 : 0;
      short = v.miss.every((i, k) => { const r = Math.floor(i / n), c = i % n, nbv = [g(r, c - 1), g(r, c + 1), g(r - 1, c), g(r + 1, c)].find(x => x >= 0); return nbv === sol[k]; }) ? 1 : 0;   // abk: Farbe des Nachbarn übernehmen
    }
    return { guess: Math.pow(1 / v.k, v.miss.length), read, short, steps: shift ? (v.order ? 3 : 2) : 1, sols: 1, space: v.miss.length * Math.log10(v.k), tag: shift ? (v.order ? 'Verschiebung + Farbschritt' : 'Verschiebung') : 'eine Regel' };
  },
  grid(p) {
    const P = logicParse(p), n = logicCount(P), r = logicSolve(P), v = p.view, space = Math.pow(fact(v.N), v.cats);
    check('Logikgitter eindeutig (vollständige Suche)', n === 1, n + ' Lösungen');
    const at = P.C.filter(c => c.ty === 'at').length, rel = P.C.filter(c => c.y !== undefined).length;
    return { guess: 1 / space, steps: r.rounds + (r.stuck ? 1 : 0), stuck: r.stuck, sols: n, space: log10(space), tag: `${v.N}×${v.cats}`,
      read: logicRead(P) ? 1 : 0, short: p.diff === 0 ? logicMention(p) : undefined, at, rel };
  }
};

/* ---------------------------------------------------------------- Lauf */
const rows = [], timing = {};
for (const type of E.TYPE_KEYS) for (let d = 0; d < 4; d++) for (let i = 0; i < N; i++) {
  const seed = `MASS|${i}`, t0 = performance.now(), p = E.generate(seed, type, d), dt = performance.now() - t0;
  const tk = `${type}|${p.sub}|${d}`; (timing[tk] ??= []).push(dt);
  (timing[type + '|*|' + d] ??= []).push(dt);
  check('keine Notlösung', !p.sig.startsWith('fb:'), type + d + ' ' + seed);
  check('validate(gespeicherte Lösung)', p.validate(p.solution) === true, type + d + ' ' + seed);
  check('drei Hinweise, Prompt, Erklärung', p.hints.length === 3 && p.hints.every(Boolean) && !!p.prompt && !!p.explain, type + d + ' ' + seed);
  if (i < 25) { const q = E.generate(seed, type, d); check('gleicher Seed, gleiches Rätsel', q.sig === p.sig, type + d + ' ' + seed); }
  const m = ANALYZE[p.sub](p);
  rows.push({ type, d, sub: p.sub, kind: p.kind, rating: p.rating, par: V2 ? 60 * p.rating : 30 + 14 * p.rating, sol: JSON.stringify(p.solution), ...m, p });
}
check('Würfelnetz von Hand (Kreuz)', !V2 || handCross(), 'Kreuznetz');
/* Easy: feste Grenzen. Kein Rätsel ohne Schluss, der Blick-Trick höchstens in der Hälfte der Fälle je Unterart,
   keine Antwortformen von Normal, klar leichter als Normal. Logikgitter: höchstens eine Platzangabe, mindestens eine Beziehung. */
for (const r of rows.filter(r => r.d === 0)) {
  check('Easy: kein Rätsel ohne Schluss lösbar', r.read === 0, r.type + ' ' + r.sub + ' ' + r.p.sig);
  check('Easy: Abkürzung je Rätsel gemessen', r.short != null, r.type + ' ' + r.sub);
  check('Easy: keine Antwortform von Normal', !['multi', 'order', 'build'].includes(r.kind) && !(r.kind === 'number' && Array.isArray(r.p.solution)), r.type + ' ' + r.kind);
  if (r.sub === 'grid') check('Easy-Logikgitter: höchstens 1 Platzangabe, mindestens 1 Beziehung, Löser braucht einen Schluss', r.at <= 1 && r.rel >= 1 && r.read === 0 && r.sols === 1, r.p.view.clues.join(' '));
}
for (const type of E.TYPE_KEYS) {
  const es = rows.filter(r => r.type === type && r.d === 0), ns = rows.filter(r => r.type === type && r.d === 1);
  for (const sub of new Set(es.map(r => r.sub))) { const sh = es.filter(r => r.sub === sub && r.short != null); check('Easy: Abkürzung höchstens 50 % je Unterart', mean(sh.map(r => r.short)) <= .5, `${type} ${sub} ${pc(mean(sh.map(r => r.short)))}`); }
  check('Easy: Richtzeit klar unter Normal', Math.max(...es.map(r => r.rating)) <= .5 * Math.min(...ns.map(r => r.rating)), type);
}
const bucket = new Map();
rows.forEach(r => { const k = r.type + r.sub + r.d + (r.tag || ''); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(r); });
bucket.forEach(rs => { if (!rs[0].num) return; const cnt = {}; rs.forEach(r => cnt[r.sol] = (cnt[r.sol] || 0) + 1); const mx = Math.max(...Object.values(cnt)) / rs.length; rs.forEach(r => r.guess = mx); });

/* ---------------------------------------------------------------- Ausgabe */
const out = [];
out.push(`# Massentest MIND//SHAPES – ${E.DAILY_VERSION.replace(/_$/, '')} (${N} Rätsel je Typ und Stufe)\n`);
out.push('| Typ | Stufe | Unterart | Anteil | par s | raten | abk | lös Ø / max | schr Ø (min) | ms Ø / max | Merkmal |');
out.push('|---|---|---|---:|---:|---:|---:|---|---|---|---|');
for (const type of E.TYPE_KEYS) for (let d = 0; d < 4; d++) {
  const rs = rows.filter(r => r.type === type && r.d === d);
  for (const sub of [...new Set(rs.map(r => r.sub))]) {
    const s = rs.filter(r => r.sub === sub), sh = s.filter(r => r.short != null), tags = {}, tm = timing[`${type}|${sub}|${d}`];
    s.forEach(r => { if (r.tag) tags[r.tag] = (tags[r.tag] || 0) + 1; });
    const tg = Object.entries(tags).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, n]) => `${k} (${Math.round(n / s.length * 100)} %)`).join(', ');
    out.push(`| ${type} | ${E.DIFF[d]} | ${sub} | ${pc(s.length / rs.length)} | ${f1(mean(s.map(r => r.par)))} | ${pc(Math.max(...s.map(r => r.guess)))} | ${sh.length ? pc(mean(sh.map(r => r.short))) : '–'} | ${f1(mean(s.map(r => r.sols)))} / ${Math.max(...s.map(r => r.sols))} | ${f1(mean(s.map(r => r.steps)))} (${Math.min(...s.map(r => r.steps))}) | ${mean(tm).toFixed(1)} / ${Math.max(...tm).toFixed(0)} | ${tg} |`);
  }
}
out.push('\n„raten“ ist hier das Maximum über alle Rätsel der Zeile, „abk“ der Mittelwert.');
out.push('\n## Easy je Unterart\n');
out.push('| Typ | Unterart | Anteil | par s | ablesbar | abk Ø | abk max | raten max |'); out.push('|---|---|---:|---:|---:|---:|---:|---:|');
const easy = {};
for (const type of E.TYPE_KEYS) { const rs = rows.filter(r => r.type === type && r.d === 0);
  for (const sub of [...new Set(rs.map(r => r.sub))]) {
    const s = rs.filter(r => r.sub === sub), rd = s.filter(r => r.read != null), sh = s.filter(r => r.short != null);
    const e = easy[type + '/' + sub] = { read: rd.length ? mean(rd.map(r => r.read)) : NaN, short: sh.length ? mean(sh.map(r => r.short)) : NaN, guess: Math.max(...s.map(r => r.guess)) };
    out.push(`| ${type} | ${sub} | ${pc(s.length / rs.length)} | ${f1(mean(s.map(r => r.par)))} | ${pc(e.read)} | ${pc(e.short)} | ${sh.length ? pc(Math.max(...sh.map(r => r.short))) : '–'} | ${pc(e.guess)} |`);
  } }
out.push('\n„ablesbar“: Anteil der Rätsel, die ohne echten Schluss lösbar sind (Festlegung je Unterart bei ANALYZE). „abk“: Erfolg des naheliegenden Blick-Tricks.');
out.push('\n## Je Typ und Stufe\n');
out.push('| Typ | Stufe | par s Ø | raten max | abk Ø | Anteil mit 1 Denkschritt | ms Ø / max |'); out.push('|---|---|---:|---:|---:|---:|---|');
for (const type of E.TYPE_KEYS) for (let d = 0; d < 4; d++) {
  const s = rows.filter(r => r.type === type && r.d === d), sh = s.filter(r => r.short != null), tm = timing[type + '|*|' + d];
  out.push(`| ${type} | ${E.DIFF[d]} | ${f1(mean(s.map(r => r.par)))} | ${pc(Math.max(...s.map(r => r.guess)))} | ${sh.length ? pc(mean(sh.map(r => r.short))) : '–'} | ${pc(s.filter(r => r.steps <= 1).length / s.length)} | ${mean(tm).toFixed(1)} / ${Math.max(...tm).toFixed(0)} |`);
}
const allT = Object.entries(timing).filter(([k]) => !k.includes('|*|')).flatMap(([, v]) => v), over = Object.entries(timing).filter(([k, v]) => !k.includes('|*|') && Math.max(...v) > BUDGET);
out.push(`\nErzeugung gesamt: Mittel ${mean(allT).toFixed(2)} ms, Maximum ${Math.max(...allT).toFixed(1)} ms (Budget ${BUDGET} ms)${over.length ? '. ÜBER BUDGET: ' + over.map(([k]) => k).join(', ') : ''}.`);

const days = [], start = Date.parse('2026-01-01T00:00:00Z');
for (let i = 0; i < 730; i++) { const date = new Date(start + i * 864e5).toISOString().slice(0, 10), p = E.dailyPuzzle(date); days.push({ p, m: ANALYZE[p.sub](p) }); }
const isChoice = x => x.p.kind === 'choice' || x.p.kind === 'net';
out.push(`\n## Daily (730 Tage ab 2026-01-01)\n`);
out.push('| Typ | Normal | Hard | par s Ø | Unterarten |'); out.push('|---|---:|---:|---:|---|');
for (const type of E.TYPE_KEYS) { const s = days.filter(x => x.p.type === type), subs = {}; s.forEach(x => subs[x.p.sub] = (subs[x.p.sub] || 0) + 1);
  out.push(`| ${type} | ${s.filter(x => x.p.diff === 1).length} | ${s.filter(x => x.p.diff === 2).length} | ${f1(mean(s.map(x => (V2 ? 60 : 14) * x.p.rating + (V2 ? 0 : 30))))} | ${Object.entries(subs).map(([k, n]) => k + ' ' + n).join(', ')} |`); }
out.push(`\nDailys mit Einzelauswahl: ${days.filter(isChoice).length} von 730. Dailys mit nur einem Denkschritt: ${days.filter(x => x.m.steps <= 1).length} von 730.`);

if (REF) {                                           // Vergleich mit einer älteren Fassung: Dailys und Normal bis Insane unverändert
  const A = engine(REF), same = (p, q) => JSON.stringify(p) === JSON.stringify(q) && p.validate(q.solution) === true && q.validate(p.solution) === true;
  const today = new Date().toISOString().slice(0, 10), t0 = Date.parse(today + 'T00:00:00Z'), dl = [];
  check('Vergleich: DAILY_VERSION gleich', A.DAILY_VERSION === E.DAILY_VERSION, A.DAILY_VERSION + ' / ' + E.DAILY_VERSION);
  for (let i = 0; i < 60; i++) { const date = new Date(t0 + i * 864e5).toISOString().slice(0, 10), p = E.dailyPuzzle(date), q = A.dailyPuzzle(date); dl.push(p.sig);
    check('Vergleich: Daily gleich (60 Tage ab heute)', same(p, q), date + ' ' + p.sig + ' / ' + q.sig); }
  for (const type of E.TYPE_KEYS) for (let d = 1; d < 4; d++) for (let i = 0; i < N; i++) { const p = E.generate(`MASS|${i}`, type, d), q = A.generate(`MASS|${i}`, type, d);
    check('Vergleich: Normal bis Insane gleich bei gleichem Seed', same(p, q), type + d + ' ' + p.sig); }
  out.push(`\nVergleich mit ${REF}: Dailys ${today} bis ${new Date(t0 + 59 * 864e5).toISOString().slice(0, 10)}, Prüfsumme der Signaturen ${(A.generate && E.generate) ? dl.reduce((h, s) => (h * 31 + [...s].reduce((x, c) => (x * 33 + c.charCodeAt(0)) >>> 0, 5381)) >>> 0, 7).toString(16) : ''}.`);
}

out.push('\n## Prüfungen\n');
out.push('| Prüfung | geprüft | Fehler |'); out.push('|---|---:|---:|');
Object.entries(checks).forEach(([k, c]) => out.push(`| ${k} | ${c.n} | ${c.bad} |`));
if (bad.length) out.push('\n' + bad.map(x => '- ' + x).join('\n'));
console.log(out.join('\n'));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(rows.map(({ p, ...r }) => ({ ...r, sig: p.sig })), null, 1));
