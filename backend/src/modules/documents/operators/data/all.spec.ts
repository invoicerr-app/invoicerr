/**
 * Drop-in invariant for the readdir-discovery mechanism - same shape as `countries/data/all.spec.ts`'s
 * own "every *.json on disk is actually loaded" block: re-reads the
 * directory with the IDENTICAL pattern `all.ts`'s own `discoverOperatorIds()` uses, independently of
 * that implementation, so a regression that silently drops a file from discovery goes red here.
 * `operators/` stays its own catalog, never merged into `countries/data/`: it is keyed by operator id
 * (superpdp, acube, billit...), not by country - see `operators/schema.ts`'s own header.
 */
import { readdirSync } from 'node:fs';

import { ALL_OPERATOR_FILES } from './all';

describe('operators/data - every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_OPERATOR_FILES covers exactly the operator files present in this directory, no more, no fewer', () => {
    const onDisk = readdirSync(__dirname)
      .filter((name) => /^[a-z0-9-]+\.json$/.test(name))
      .map((name) => name.replace(/\.json$/, ''))
      .sort();
    const loaded = ALL_OPERATOR_FILES.map((f) => f.id).sort();
    expect(loaded).toEqual(onDisk);
  });

  it('every shipped operator file id matches its own filename', () => {
    // Already enforced at load time (loadOperatorFile throws on a mismatch) - this test exists so a
    // future refactor that accidentally loosens that check is caught here too, not only by whichever
    // single file happens to drift first.
    expect(ALL_OPERATOR_FILES.length).toBeGreaterThan(0);
    const onDisk = readdirSync(__dirname)
      .filter((name) => /^[a-z0-9-]+\.json$/.test(name))
      .map((name) => name.replace(/\.json$/, ''));
    for (const id of onDisk) {
      expect(ALL_OPERATOR_FILES.find((f) => f.id === id)).toBeDefined();
    }
  });
});
