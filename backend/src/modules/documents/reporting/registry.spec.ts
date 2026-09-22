/**
 * The reporting-obligation mechanism itself — read as DATA (this spec proves it, never a hard-coded
 * `if countryCode === 'HU'` anywhere in the product code), the same discipline
 * `transports/channel-policy/registry.spec.ts` already holds for its own mechanism.
 */
import { ALL_REPORTING_OBLIGATION_FILES } from './data/all';
import { assertValidReportingObligationFact } from './schema';
import { defaultReportingObligationCatalog, ReportingObligationCatalog } from './registry';

describe('reporting obligation files — loaded, not hard-coded', () => {
  // HU ("nav") and GR ("mydata") — the first two countries this mechanism ever shipped a reporting
  // obligation for — were both removed by the 5-country prune (2026-09-10). PT ("pt-at", the AT
  // "comunicação de faturas" webservice) was the first entry the 5-country lineup itself shipped —
  // see `reporting/data/pt.json`'s own `notes` and `providers/pt-at-client.ts`'s own header for its
  // "implemented to the documented AT contract, awaiting accreditation" status. FR ("pdp" transport +
  // an unregistered "fr-ereporting" placeholder — see `data/fr.json`'s own facts) followed once the
  // schema grew `dischargedBy`/`scope`. DE/IT/PL still have no file at all, and the registry tolerates
  // that cleanly: every lookup for one of THOSE countries below behaves exactly like "a country with
  // no file", never a crash or a permissive fallback. The HU/GR PROVIDER implementations, left in
  // place after the data-only prune above, were DELETED OUTRIGHT by a later pass (2026-09-12, see
  // `documentation/docs/developer-guide/live-testing.md`): unreachable dead code for a country nobody
  // asked to support is still a country nobody asked to support.
  it('the shipped catalog now carries exactly FR and PT — GR/HU stay removed by the 5-country prune', () => {
    expect(ALL_REPORTING_OBLIGATION_FILES.map((f) => f.countryCode)).toEqual(['FR', 'PT']);
  });

  it('a country with NO reporting-obligation file at all (e.g. DE, or the formerly-shipped HU/GR) has no fact and no obligation — never a crash', () => {
    for (const countryCode of ['DE', 'HU', 'GR']) {
      expect(defaultReportingObligationCatalog.factsFor(countryCode)).toEqual([]);
      expect(defaultReportingObligationCatalog.obligationFor(countryCode, 'invoice')).toBeUndefined();
    }
  });

  it('lower-cased or absent country codes never crash — no fact, not a throw', () => {
    expect(defaultReportingObligationCatalog.factsFor('pt')).toEqual(
      defaultReportingObligationCatalog.factsFor('PT'),
    );
    expect(defaultReportingObligationCatalog.factsFor('')).toEqual([]);
    expect(defaultReportingObligationCatalog.obligationFor(undefined, 'invoice')).toBeUndefined();
  });

  it('every shipped file has already passed provenance validation at load time', () => {
    expect(ALL_REPORTING_OBLIGATION_FILES.length).toBe(2);
    for (const file of ALL_REPORTING_OBLIGATION_FILES) {
      for (const fact of file.facts) {
        expect(() => assertValidReportingObligationFact(fact, 'test')).not.toThrow();
      }
    }
  });

  it('PT resolves to the "pt-at" provider for an invoice — reachable via the SAME generic lookup every sibling country goes through', () => {
    expect(defaultReportingObligationCatalog.obligationFor('PT', 'invoice')?.providerId).toBe('pt-at');
  });

  // THE real-data proof that `obligationFor`'s new `dischargedBy`/`scope` filter actually holds for
  // France, not only for a synthetic fixture below: every FR fact is either transport-discharged (the
  // PDP already carries the data) or scope-restricted (no per-invoice classifier exists yet) — see
  // `registry.ts#obligationFor`'s own header.
  it('FR has THREE facts (settings-screen visible via factsFor) but ZERO auto-triggerable obligation (obligationFor)', () => {
    expect(defaultReportingObligationCatalog.factsFor('FR')).toHaveLength(3);
    expect(defaultReportingObligationCatalog.obligationFor('FR', 'invoice')).toBeUndefined();
  });

  it('a bespoke catalog (constructor injection) is independent of the shipped one — the shipped catalog, now empty, is NOT implicitly merged in, and vice versa', () => {
    const custom = new ReportingObligationCatalog([
      {
        countryCode: 'ZZ',
        facts: [
          {
            providerId: 'fixture-provider',
            appliesTo: 'invoice',
            dischargedBy: 'provider',
            provenance: { kind: 'unverified', resolutionNote: 'test fixture' },
          },
        ],
      },
    ]);
    expect(custom.obligationFor('ZZ', 'invoice')?.providerId).toBe('fixture-provider');
    expect(defaultReportingObligationCatalog.factsFor('ZZ')).toEqual([]);
  });
});

describe('ReportingObligationCatalog.obligationFor — the dischargedBy/scope auto-trigger filter', () => {
  const catalog = new ReportingObligationCatalog([
    {
      countryCode: 'ZZ',
      facts: [
        {
          providerId: 'zz-transport',
          appliesTo: 'invoice',
          dischargedBy: 'transport',
          provenance: { kind: 'unverified', resolutionNote: 'fixture: transport-discharged' },
        },
        {
          providerId: 'zz-scoped',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          scope: [{ transactions: 'b2c' }],
          provenance: { kind: 'unverified', resolutionNote: 'fixture: scoped' },
        },
        {
          providerId: 'zz-unscoped',
          appliesTo: 'credit-note',
          dischargedBy: 'provider',
          provenance: { kind: 'unverified', resolutionNote: 'fixture: unscoped, safe to auto-trigger' },
        },
      ],
    },
  ]);

  it('never auto-triggers a "transport"-discharged fact, nor a scoped one for the same type', () => {
    // Both "zz-transport" (dischargedBy: 'transport') and "zz-scoped" (scope-restricted) apply to
    // "invoice" in this fixture — neither is safe to auto-fire, so this must stay undefined.
    expect(catalog.obligationFor('ZZ', 'invoice')).toBeUndefined();
  });

  it('never auto-triggers a fact with a "scope" restriction', () => {
    const scopedOnly = new ReportingObligationCatalog([
      {
        countryCode: 'YY',
        facts: [
          {
            providerId: 'yy-scoped',
            appliesTo: 'invoice',
            dischargedBy: 'provider',
            scope: [{ transactions: 'payments' }],
            provenance: { kind: 'unverified', resolutionNote: 'fixture' },
          },
        ],
      },
    ]);
    expect(scopedOnly.obligationFor('YY', 'invoice')).toBeUndefined();
  });

  it('DOES auto-trigger an unscoped, "provider"-discharged fact — the one safe shape', () => {
    expect(catalog.obligationFor('ZZ', 'credit-note')?.providerId).toBe('zz-unscoped');
  });

  it('factsFor stays UNFILTERED — every fact is still visible to the settings screen', () => {
    expect(catalog.factsFor('ZZ')).toHaveLength(3);
  });
});
