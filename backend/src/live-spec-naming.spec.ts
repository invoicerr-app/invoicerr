import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Enforces the ONE live-spec naming convention this repo actually uses: `*.live.spec.ts` (a DOT
 * before "live"), never `*-live.spec.ts` (a hyphen). Not cosmetic: a 2026-09-14 security audit of
 * every `*.live.spec.ts` (these are the specs that hit real external APIs — see `live-gate.ts`)
 * started with `find -name "*.live.spec.ts"` and SILENTLY missed five files that used the
 * hyphenated form instead — `choruspro-live.spec.ts` among them, the very channel that motivated
 * the audit in the first place (also `ksef-live.spec.ts`, `tsa-live.spec.ts`,
 * `peppol-sh-live.spec.ts`, `peppol-sh-xrechnung-live.spec.ts`; all five were renamed to the dot
 * form the day this guard was added). Any future tool, search, or CI step keyed on the canonical
 * dot pattern — as `documentation/docs/developer-guide/live-testing.md` already is — will repeat
 * that exact silent miss unless the convention actually holds on every commit, not just the day
 * someone remembers to grep for it.
 *
 * Scans `git ls-files` (tracked + untracked-but-present, `--exclude-standard` so `dist/` and
 * friends are never considered) for the WRONG shape rather than allowlisting the right one: a
 * `-live.spec.ts` suffix is unambiguous and never legitimately means anything else in this repo
 * (checked 2026-09-14: zero non-live `*-live.*` files exist), so no exclusion list is needed.
 */
describe('live-spec file naming convention', () => {
  it('rejects any tracked "*-live.spec.ts" (hyphen) file — only "*.live.spec.ts" (dot) is allowed', () => {
    const repoRoot = resolve(__dirname, '..', '..');
    const files = execSync('git ls-files -c -o --exclude-standard', {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 64,
    })
      .toString('utf8')
      .split('\n')
      .filter(Boolean);

    const offenders = files.filter((file) => /(?:^|\/)[^/]+-live\.spec\.ts$/.test(file));

    if (offenders.length === 0) return;

    throw new Error(
      `Found ${offenders.length} live-spec file(s) using the WRONG "-live.spec.ts" (hyphen) naming:\n` +
        offenders.map((file) => `  ${file}`).join('\n') +
        '\n\nRename to "*.live.spec.ts" (dot before "live") with `git mv`, then fix every comment/doc ' +
        "that cites the old name. This is not cosmetic — see this spec's own header: a 2026-09-14 " +
        'security audit keyed on the dot pattern already missed five files this way, including the ' +
        'one channel (`choruspro-live.spec.ts`) the audit was run to check.',
    );
  });
});
