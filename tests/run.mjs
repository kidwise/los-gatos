// Runs every play test in turn and reports which passed. Usage: npm test [name ...]
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { URL as GAME } from './helper.mjs';

try {
  await fetch(GAME);
} catch {
  console.error(`The game is not running at ${GAME}. Start it with "npm run dev" in another terminal.`);
  process.exit(1);
}
const wanted = process.argv.slice(2);
const files = readdirSync(new URL('.', import.meta.url)).filter((f) => f.endsWith('.test.mjs') && (wanted.length === 0 || wanted.some((w) => f.startsWith(w))));
const failed = [];
for (const file of files) {
  console.log(`\n${file.replace('.test.mjs', '')}`);
  const run = spawnSync(process.execPath, [new URL(file, import.meta.url).pathname], { stdio: 'inherit' });
  if (run.status !== 0) failed.push(file.replace('.test.mjs', ''));
}
console.log(failed.length ? `\nFailed: ${failed.join(', ')}` : `\nAll ${files.length} tests passed.`);
process.exit(failed.length ? 1 : 0);
