/**
 * The reporting-obligation mechanism itself — read as DATA (this spec proves it, never a hard-coded
 * `if countryCode === 'HU'` anywhere in the product code), the same discipline
 * `transports/channel-policy/registry.spec.ts` already holds for its own mechanism.
 */
import { ALL_REPORTING_OBLIGATION_FILES } from './data/all';
import { assertValidReportingObligationFact } from './schema';
import { defaultReportingObligationCatalog, ReportingObligationCatalog } from './registry';

describe('reporting obligation files — loaded, not hard-coded', () => {
  it('HU declares a "nav" obligation for invoices, with legal provenance — a fact read from data/hu.json', () => {
    expect(defaultReportingObligationCatalog.factsFor('HU')).toEqual([
      expect.objectContaining({
        providerId: 'nav',
        appliesTo: 'invoice',
        provenance: expect.objectContaining({ kind: 'legal' }),
      }),
    ]);
  });

  it('GR declares a "mydata" obligation for invoices, honestly unverified — a fact read from data/gr.json', () => {
    expect(defaultReportingObligationCatalog.factsFor('GR')).toEqual([
      expect.objectContaining({
        providerId: 'mydata',
        appliesTo: 'invoice',
        provenance: expect.objectContaining({ kind: 'unverified' }),
      }),
    ]);
  });

  it('obligationFor resolves the HU "nav" fact for an invoice', () => {
    expect(defaultReportingObligationCatalog.obligationFor('HU', 'invoice')).toEqual(
      expect.objectContaining({ providerId: 'nav' }),
    );
  });

  it('obligationFor is undefined for a document type HU has no fact for', () => {
    expect(defaultReportingObligationCatalog.obligationFor('HU', 'credit-note')).toBeUndefined();
  });

  it('a country with NO reporting-obligation file at all (e.g. FR) has no fact and no obligation', () => {
    expect(defaultReportingObligationCatalog.factsFor('FR')).toEqual([]);
    expect(defaultReportingObligationCatalog.obligationFor('FR', 'invoice')).toBeUndefined();
  });

  it('lower-cased or absent country codes never crash — no fact, not a throw', () => {
    expect(defaultReportingObligationCatalog.factsFor('hu')).toEqual(
      defaultReportingObligationCatalog.factsFor('HU'),
    );
    expect(defaultReportingObligationCatalog.factsFor('')).toEqual([]);
    expect(defaultReportingObligationCatalog.obligationFor(undefined, 'invoice')).toBeUndefined();
  });

  it('every shipped file has already passed provenance validation at load time', () => {
    expect(ALL_REPORTING_OBLIGATION_FILES.length).toBeGreaterThan(0);
    for (const file of ALL_REPORTING_OBLIGATION_FILES) {
      for (const fact of file.facts) {
        expect(() => assertValidReportingObligationFact(fact, 'test')).not.toThrow();
      }
    }
  });

  it('a bespoke catalog (constructor injection) is independent of the shipped one', () => {
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
    expect(custom.factsFor('HU')).toEqual([]); // the shipped hu.json is NOT implicitly merged in
  });
});
