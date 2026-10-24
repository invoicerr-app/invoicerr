// Usage: node bundle.mjs (reads frontend/dist). Prints gzip bytes of each chunk index.html loads eagerly.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';

const dist = resolve(import.meta.dirname, '../../frontend/dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const files = [...new Set([...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]))];
let total = 0;
for (const f of files) {
  const gz = gzipSync(readFileSync(join(dist, f)), { level: 9 }).length;
  total += gz;
  console.log(`${f}\t${gz}`);
}
console.log(`eager_total_gzip\t${total}`);
