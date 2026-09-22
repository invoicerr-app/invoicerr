/**
 * Invoicerr never tells Polar how many seats to bill — it only reads what Polar says (webhook
 * `subscription.*` facts and `seat-reconcile.ts`'s own periodic SDK read). This is a standing,
 * file-content guard against that regressing: every `.ts` source file in this module is scanned for a
 * `subscriptions.update(...)` call whose own argument block sets a `seats` field — if one ever
 * reappears (someone re-adding the old automatic seat push), this test fails loudly rather than relying
 * on every future reviewer remembering the rule by hand.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MODULE_DIR = __dirname;

/** How far past a `subscriptions.update(` call's own opening paren to look for a `seats:` key — large
 *  enough to cover a real, multi-line call's whole argument object, small enough that an UNRELATED
 *  `seats:` far later in the same file (a different call entirely) is never mistaken for part of it. */
const SNIPPET_LENGTH = 400;

/** A plain manual walk (never `{ recursive: true }`/`Dirent.parentPath`, both too recent to rely on
 *  across every Node 20.x point release CI might run) — this module is shallow (one `queue/`
 *  subdirectory), so one level of recursion is all this ever needs in practice, but the walk itself is
 *  general. */
function sourceFiles(dir: string = MODULE_DIR): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('no seat quantity write reaches Polar', () => {
  it('no subscriptions.update(...) call in billing/ sets a seats field', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const contents = readFileSync(file, 'utf8');
      const callSites = [...contents.matchAll(/subscriptions\.update\(/g)];
      for (const call of callSites) {
        const start = call.index ?? 0;
        const snippet = contents.slice(start, start + SNIPPET_LENGTH);
        if (/\bseats\s*:/.test(snippet)) {
          offenders.push(`${file}@${start}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
