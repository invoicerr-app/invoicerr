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
  // obligation for — were both removed by the 5-country prune (2026-09-10): FR/PL/IT/PT/DE had no
  // data/xx.json here at that point. PT ("pt-at", the AT "comunicação
  // de faturas" webservice) is the first entry the 5-country lineup itself ships — see
  // `reporting/data/pt.json`'s own `notes` and `providers/pt-at-client.ts`'s own header for its
  // "implemented to the documented AT contract, awaiting accreditation" status. FR/DE/IT still have no
  // file at all, and the registry tolerates that cleanly: every lookup for one of THOSE countries
  // below behaves exactly like "a country with no file", never a crash or a permissive fallback. The
  // `nav-client.ts`/`mydata-client.ts` PROVIDER implementations are left in place — they are
  // reachable again the moment a country data file names their `providerId`.
  it('the shipped catalog now carries exactly PT — GR/HU stay removed by the 5-country prune', () => {
    expect(ALL_REPORTING_OBLIGATION_FILES.map((f) => f.countryCode)).toEqual(['PT']);
  });

  it('a country with NO reporting-obligation file at all (e.g. FR, or the formerly-shipped HU/GR) has no fact and no obligation — never a crash', () => {
    for (const countryCode of ['FR', 'HU', 'GR']) {
      expect(defaultReportingObligationCatalog.factsFor(countryCode)).toEqual([]);
      expect(defaultReportingObligationCatalog.obligationFor(countryCode, 'invoice')).toBeUndefined();
    }
  });

  it('lower-cased or absent country codes never crash — no fact, not a throw', () => {
    expect(defaultReportingObligationCatalog.factsFor('fr')).toEqual(
      defaultReportingObligationCatalog.factsFor('FR'),
    );
    expect(defaultReportingObligationCatalog.factsFor('')).toEqual([]);
    expect(defaultReportingObligationCatalog.obligationFor(undefined, 'invoice')).toBeUndefined();
  });

  it('every shipped file has already passed provenance validation at load time', () => {
    expect(ALL_REPORTING_OBLIGATION_FILES.length).toBe(1);
    for (const file of ALL_REPORTING_OBLIGATION_FILES) {
      for (const fact of file.facts) {
        expect(() => assertValidReportingObligationFact(fact, 'test')).not.toThrow();
      }
    }
  });

  it('PT resolves to the "pt-at" provider for an invoice — reachable via the SAME generic lookup every sibling country goes through', () => {
    expect(defaultReportingObligationCatalog.obligationFor('PT', 'invoice')?.providerId).toBe('pt-at');
  });

  it('a bespoke catalog (constructor injection) is independent of the shipped one — the shipped catalog, now empty, is NOT implicitly merged in, and vice versa', () => {
    const custom = new ReportingObligationCatalog([
      {
        countryCode: 'ZZ',
        facts: [
          {
            providerId: 'fixture-provider',
            appliesTo: 'invoice',
            provenance: { kind: 'unverified', resolutionNote: 'test fixture' },
          },
        ],
      },
    ]);
    expect(custom.obligationFor('ZZ', 'invoice')?.providerId).toBe('fixture-provider');
    expect(defaultReportingObligationCatalog.factsFor('ZZ')).toEqual([]);
  });
});
