#!/usr/bin/env node
/* MIND//SHAPES – alle drei Tests nacheinander: Massentest, Klicktest im Lab, Endless-Läufe.
   Endet nur dann mit 0, wenn alle drei mit 0 enden. Weitere Argumente gehen an den Massentest (z. B. --ref alt.html).
     NODE_PATH=<ordner mit node_modules> CHROME=<pfad zu chrome> node test/alle.mjs */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const DIR = dirname(fileURLToPath(import.meta.url)), extra = process.argv.slice(2), out = [];
for (const [name, args] of [['difficulty.mjs', extra], ['ui.mjs', []], ['endless.mjs', []]]) {
  console.log(`\n===== ${name}`);
  const t0 = Date.now(), r = spawnSync(process.execPath, [join(DIR, name), ...args], { stdio: 'inherit', env: process.env });
  out.push({ name, code: r.status ?? 1, s: ((Date.now() - t0) / 1000).toFixed(0) });
}
console.log('\n===== Ergebnis');
for (const r of out) console.log(`${r.code === 0 ? 'grün' : 'ROT '}  ${r.name}  (Fehlercode ${r.code}, ${r.s} s)`);
process.exitCode = out.every(r => r.code === 0) ? 0 : 1;
