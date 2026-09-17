import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ALL_COUNTRY_POLICY_FILES } from '@/modules/documents/country-policy/data/all';
import { ALL_CORRECTION_ROUTES_FILES } from '@/modules/documents/correction-routes/data/all';
import { ALL_COUNTRY_IDENTIFIER_FILES } from '@/modules/documents/country-identifiers/data/all';
import { ALL_TAX_SYSTEM_FILES } from '@/modules/documents/tax/tax-systems/data/all';
import { ALL_VAT_RATE_FILES } from '@/modules/documents/vat-rates/data/all';
import { ALL_CHANNEL_POLICY_FILES } from '@/modules/documents/transports/channel-policy/data/all';

import { ALL_MENTIONS_FILES } from '@/modules/documents/mentions/data/all';
import { CountryMentionsFile } from '@/modules/documents/mentions/schema';

import {
  ALL_DOCUMENT_CATALOG_DIRS,
  computeMentionWindowAlerts,
  CountryReadinessService,
} from './country-readiness.service';

/**
 * Deliberately re-derives its expectations from the SAME `ALL_*_FILES` exports the service itself
 * reads — the source-of-truth files on disk, not a reimplementation of the service's own logic — so
 * nothing here hardcodes "FR is complete" or "PL/IT/DE miss X" as a magic fact that would silently go
 * stale the moment a `data/xx.json` is added or removed by the prune (or any future country work).
 * Every assertion below still exercises the real `CountryReadinessService` as a black box.
 */
const MECHANISM_FILES: Record<string, readonly { countryCode: string }[]> = {
  'country-policy': ALL_COUNTRY_POLICY_FILES,
  'vat-rates': ALL_VAT_RATE_FILES,
  'tax-systems': ALL_TAX_SYSTEM_FILES,
  'correction-routes': ALL_CORRECTION_ROUTES_FILES,
  'country-identifiers': ALL_COUNTRY_IDENTIFIER_FILES,
  'channel-policy': ALL_CHANNEL_POLICY_FILES,
};
const MECHANISM_IDS = Object.keys(MECHANISM_FILES);

function mechanismsCovering(countryCode: string): string[] {
  return MECHANISM_IDS.filter((id) =>
    MECHANISM_FILES[id].some((f) => f.countryCode.toUpperCase() === countryCode),
  );
}

function allKnownCountryCodes(): Set<string> {
  const codes = new Set<string>();
  for (const files of Object.values(MECHANISM_FILES)) {
    for (const f of files) codes.add(f.countryCode.toUpperCase());
  }
  return codes;
}

/**
 * Walks `documents/` on disk and returns every directory (relative to `root`, `/`-separated) that
 * ships a `data/all.ts` aggregator — the exact signature every catalog under `documents/` uses (see
 * e.g. `country-policy/data/all.ts`'s own header). This is the auto-discovery half of the fix for
 * `ALL_DOCUMENT_CATALOG_DIRS`'s own past bug: the total catalog count used to live only as prose in
 * `country-readiness.service.ts`'s header comment ("Twelve catalogs…") and silently went stale the day
 * `domestic-reverse-charge/` shipped a thirteenth. Re-deriving the real set from disk here, instead of
 * trusting the service's own list, means a fourteenth catalog (or a deleted one) fails THIS test
 * rather than leaving a comment to drift again.
 */
function discoverDocumentCatalogDirs(root: string, relDir = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, relDir), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (existsSync(join(root, childRel, 'data', 'all.ts'))) found.push(childRel);
    found.push(...discoverDocumentCatalogDirs(root, childRel));
  }
  return found;
}

describe('CountryReadinessService', () => {
  let service: CountryReadinessService;

  beforeEach(() => {
    service = new CountryReadinessService();
  });

  it('only ever reports the 6 CŒUR mechanism ids, never mentions/content-requirements', () => {
    const result = service.getReadiness('ZZ');
    expect([...result.present, ...result.missing].sort()).toEqual([...MECHANISM_IDS].sort());
  });

  it(
    'the core mechanisms + the documented exclusions together account for EVERY catalog directory ' +
      'that actually exists under documents/ — found by walking the filesystem for data/all.ts files, ' +
      "not by trusting the service's own list, so a catalog added (or removed) without updating " +
      "the header comment's count fails HERE instead of only being wrong in prose",
    () => {
      const documentsRoot = join(__dirname, '../documents');
      const discovered = discoverDocumentCatalogDirs(documentsRoot).sort();
      expect(discovered).toEqual([...ALL_DOCUMENT_CATALOG_DIRS].sort());
    },
  );

  it(
    'reports complete=true, with all 6 mechanisms present, for a country that has a data/xx.json ' +
      'file in every one of the 6 core mechanisms today — found by scanning the files, not asserted ' +
      'to be any particular country',
    () => {
      const fullySupported = [...allKnownCountryCodes()].filter(
        (code) => mechanismsCovering(code).length === MECHANISM_IDS.length,
      );
      // Sanity: the fixture this test runs against must actually contain at least one such country
      // today (FR, per the prune) — if this ever goes empty, the OTHER two tests below lose their
      // contrast case, not just this one.
      expect(fullySupported.length).toBeGreaterThan(0);

      for (const code of fullySupported) {
        const result = service.getReadiness(code);
        expect(result.countryCode).toBe(code);
        expect(result.complete).toBe(true);
        expect(result.missing).toEqual([]);
        expect(result.present.sort()).toEqual([...MECHANISM_IDS].sort());
      }
    },
  );

  it(
    'reports complete=false with the EXACT missing mechanisms for a country kept in the product ' +
      'but only partially wired (present in some core mechanisms, not all) — found by scanning the ' +
      'files, not asserted to be any particular country — or, once every shipped country has reached ' +
      'full 6-mechanism coverage, documents that explicitly instead of failing on a stale assumption',
    () => {
      const partial = [...allKnownCountryCodes()].filter((code) => {
        const covering = mechanismsCovering(code).length;
        return covering > 0 && covering < MECHANISM_IDS.length;
      });

      if (partial.length === 0) {
        // country-identifiers/data/it.json and pl.json (added alongside DE/FR/PT's own files), and
        // later transports/channel-policy/data/de.json + pt.json, closed every remaining gap: every
        // one of the 5 shipped countries (DE, FR, IT, PL, PT) now has a data/xx.json file in all 6
        // core mechanisms, so there is currently no
        // "partially wired" country left for this branch to exercise against real data — the
        // product reaching completeness, not a broken test. Asserting that explicitly here (rather
        // than skipping silently) means the day a mechanism gap reopens for any shipped country —
        // a new mechanism added, a country's file removed from one of them — this branch starts
        // exercising itself again with NO code change needed here.
        expect(
          [...allKnownCountryCodes()].every(
            (code) => mechanismsCovering(code).length === MECHANISM_IDS.length,
          ),
        ).toBe(true);
        return;
      }

      for (const code of partial) {
        const expectedPresent = mechanismsCovering(code);
        const expectedMissing = MECHANISM_IDS.filter((id) => !expectedPresent.includes(id));

        const result = service.getReadiness(code);
        expect(result.countryCode).toBe(code);
        expect(result.complete).toBe(false);
        expect(result.present.sort()).toEqual(expectedPresent.sort());
        expect(result.missing.sort()).toEqual(expectedMissing.sort());
        expect(result.missing.length).toBeGreaterThan(0);
      }
    },
  );

  it(
    'reports complete=false with ALL 6 mechanisms missing for a country with no data/xx.json file ' +
      'in any core mechanism at all — e.g. one pruned out of the product entirely',
    () => {
      // ISO 3166-1 alpha-2 "ZZ" is a permanently user-assigned/reserved code — it will never legitimately
      // become a real country file, so this never needs updating no matter what the catalogs contain.
      const removedCode = 'ZZ';
      expect(allKnownCountryCodes().has(removedCode)).toBe(false);

      const result = service.getReadiness(removedCode);
      expect(result.countryCode).toBe(removedCode);
      expect(result.complete).toBe(false);
      expect(result.present).toEqual([]);
      expect(result.missing.sort()).toEqual([...MECHANISM_IDS].sort());
    },
  );

  it('is case-insensitive and trims whitespace on the input code', () => {
    const [anyKnownCode] = [...allKnownCountryCodes()];
    expect(service.getReadiness(anyKnownCode.toLowerCase())).toEqual(service.getReadiness(anyKnownCode));
    expect(service.getReadiness(`  ${anyKnownCode}  `)).toEqual(service.getReadiness(anyKnownCode));
  });

  describe('computeMentionWindowAlerts', () => {
    // A synthetic fixture (never the real fr.json) so these assertions never depend on whatever
    // dates happen to be shipped on the day this spec runs — see the function's own header on why
    // `files` is an overridable parameter for exactly this reason.
    const fixture: Pick<CountryMentionsFile, 'countryCode' | 'noteValues'>[] = [
      {
        countryCode: 'fr', // lowercase on purpose — proves the alert's own countryCode is normalized.
        noteValues: {
          // Every window bounded, latest one ends soon — MUST alert.
          lateFeeRate: [
            { validFrom: '2026-01-01', validTo: '2026-07-01', value: '12,15 %' },
            { validFrom: '2026-07-01', validTo: '2027-01-01', value: '12,40 %' },
          ],
          // Open-ended (no validTo on its one entry) — must NEVER alert, regardless of the date.
          recoveryIndemnity: [{ validFrom: '2012-01-01', value: '40 €' }],
        },
      },
      {
        countryCode: 'DE',
        noteValues: {
          // Bounded, but its horizon is far in the future — must NOT alert yet.
          farAway: [{ validFrom: '2026-01-01', validTo: '2030-01-01', value: 'x' }],
        },
      },
    ];

    it('alerts on a field whose every window is bounded and whose horizon is within 90 days', () => {
      const alerts = computeMentionWindowAlerts(new Date('2026-11-01T00:00:00.000Z'), fixture);
      expect(alerts).toContainEqual({
        countryCode: 'FR',
        field: 'lateFeeRate',
        expiresOn: '2027-01-01',
        daysRemaining: 61,
      });
    });

    it('does NOT alert yet when the horizon is more than 90 days away', () => {
      const alerts = computeMentionWindowAlerts(new Date('2026-08-01T00:00:00.000Z'), fixture);
      expect(alerts.find((a) => a.countryCode === 'FR' && a.field === 'lateFeeRate')).toBeUndefined();
      expect(alerts.find((a) => a.countryCode === 'DE' && a.field === 'farAway')).toBeUndefined();
    });

    it('alerts with a NEGATIVE daysRemaining once the horizon has already passed — a lapse already in effect', () => {
      const alerts = computeMentionWindowAlerts(new Date('2027-06-01T00:00:00.000Z'), fixture);
      const alert = alerts.find((a) => a.countryCode === 'FR' && a.field === 'lateFeeRate');
      expect(alert).toBeDefined();
      expect(alert!.daysRemaining).toBeLessThan(0);
    });

    it('never alerts on a field with at least one open-ended entry, no matter how far in the future "now" is', () => {
      const alerts = computeMentionWindowAlerts(new Date('2099-01-01T00:00:00.000Z'), fixture);
      expect(alerts.find((a) => a.field === 'recoveryIndemnity')).toBeUndefined();
    });

    it('defaults to the REAL shipped catalog when no fixture is passed', () => {
      // Not asserting a specific date here (that would go stale the moment fr.json's own window is
      // extended) — only that this call path actually reads ALL_MENTIONS_FILES, proven by comparing
      // against a call that is handed the SAME real data explicitly.
      const withDefault = computeMentionWindowAlerts(new Date('2026-11-01T00:00:00.000Z'));
      const withExplicitRealFiles = computeMentionWindowAlerts(
        new Date('2026-11-01T00:00:00.000Z'),
        ALL_MENTIONS_FILES,
      );
      expect(withDefault).toEqual(withExplicitRealFiles);
    });
  });

  describe('listFullySupportedCountries', () => {
    it('returns exactly the sorted set of countries present in every core mechanism', () => {
      const expected = [...allKnownCountryCodes()]
        .filter((code) => mechanismsCovering(code).length === MECHANISM_IDS.length)
        .sort();

      expect(service.listFullySupportedCountries()).toEqual(expected);
    });

    it('agrees with getReadiness: every returned code is complete, every complete code is returned', () => {
      const fullySupported = new Set(service.listFullySupportedCountries());
      for (const code of allKnownCountryCodes()) {
        expect(service.getReadiness(code).complete).toBe(fullySupported.has(code));
      }
    });
  });
});
