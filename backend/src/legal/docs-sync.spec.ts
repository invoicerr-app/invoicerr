/**
 * Fails the moment `./data/*.md` (the runtime copy this API embeds, via `nest-cli.json`'s `**\/*.md`
 * asset rule) drifts from `documentation/docs/legal/*.md` (the source of truth) — the exact "a data
 * file you EDIT reaches a running server; drift between the two never gets caught automatically
 * otherwise" gap `scripts/sync-legal-docs.ts`'s own header describes. Run `npm run legal:sync` (from
 * `backend/`) to fix a failure here.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_DIR = join(__dirname, '..', '..', '..', 'documentation', 'docs', 'legal');
const DEST_DIR = join(__dirname, 'data');

describe('legal docs sync (documentation/docs/legal vs backend/src/legal/data)', () => {
  const sourceFiles = readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const destFiles = readdirSync(DEST_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();

  it('has exactly the same set of files on both sides', () => {
    expect(destFiles).toEqual(sourceFiles);
  });

  it.each(sourceFiles)('%s is byte-identical in both locations', (filename) => {
    const source = readFileSync(join(SOURCE_DIR, filename), 'utf-8');
    const dest = readFileSync(join(DEST_DIR, filename), 'utf-8');
    expect(dest).toBe(source);
  });
});
