/**
 * Drop-in invariant for the readdir-discovery conversion (this mechanism had no `all.spec.ts` before
 * it — `registry.spec.ts` already proves `ALL_CHANNEL_POLICY_FILES` loads without throwing). This
 * test re-reads the directory with the IDENTICAL pattern `all.ts`'s own `discoverCountryCodes()`
 * uses, independently of that implementation, so a regression that silently drops a file from
 * discovery (a typo'd pattern, a change that stops sorting, anything) goes red here — the whole point
 * of "adding a country = dropping a file" is only true if this holds.
 */
import { ALL_CHANNEL_POLICY_FILES } from './all';

describe('channel-policy/data — every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_CHANNEL_POLICY_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const { readdirSync } = require('node:fs');
    const onDisk = readdirSync(__dirname)
      .filter((name: string) => /^[a-z]{2}\.json$/.test(name))
      .map((name: string) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_CHANNEL_POLICY_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});
