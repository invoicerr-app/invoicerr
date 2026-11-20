import { describe, expect, it } from 'vitest';
import { LEGACY_REPORTING_FILES } from './__fixtures__/legacy-reporting-files';
import { ALL_REPORTING_OBLIGATION_FILES } from './data/all';
import {
  assertValidReportingObligation,
  assertValidReportingObligationFileV2,
  CountryReportingObligationFileV2,
  InvalidReportingObligationError,
  LegacyReportingUpgradeError,
  ReportingObligation,
  upgradeLegacyFacts,
} from './obligation-v2';
import { InvalidReportingObligationProvenanceError } from './schema';

const CONTEXT = 'test.json#reporting';

/** What a JSON file can hold where the type would refuse it: each refusal case writes such a value. */
// biome-ignore lint/suspicious/noExplicitAny: the refusal cases deliberately write values the type forbids.
type Loose = Record<string, any>;

const legal = { kind: 'legal' as const, sourceText: 'Art. 1', sourceCheckedAt: '2026-11-13' };

function valid(): ReportingObligation {
  return {
    id: 'vies:summary',
    authority: { countryCode: 'DE', name: 'Bundeszentralamt für Steuern' },
    kind: 'summary',
    trigger: 'period-end',
    scope: { documentTypes: ['invoice', 'credit-note'], transactions: [{ transactions: 'international' }] },
    sellerConditions: { companyProfile: { ecSalesListPeriod: ['MONTHLY'] } },
    applicability: [{ from: '2020-01-01', until: '2030-01-01', provenance: legal }],
    legalBasis: { provenance: legal, validFrom: '2010-01-01' },
    timing: { period: 'month' },
    channels: [
      { dischargedBy: 'export', id: 'zm-csv', unit: 'period' },
      { dischargedBy: 'manual', id: 'elster', unit: 'period' },
    ],
  };
}

/** A deep copy of the valid obligation with one change applied, typed loosely on purpose: each case
 *  writes a value the type would refuse, which is exactly what a JSON file can hold. */
function withChange(change: (o: Loose) => void): ReportingObligation {
  const copy = structuredClone(valid()) as Loose;
  change(copy);
  return copy as ReportingObligation;
}

describe('v2 reporting obligation validator', () => {
  it('accepts a complete obligation', () => {
    expect(() => assertValidReportingObligation(valid(), CONTEXT)).not.toThrow();
  });

  it('accepts a per-document obligation with a deadline and no optional fields', () => {
    const minimal: ReportingObligation = {
      id: 'x',
      authority: { countryCode: 'PT' },
      kind: 'data',
      trigger: 'issued',
      scope: { documentTypes: ['invoice'] },
      legalBasis: { provenance: legal },
      timing: { deadline: { daysAfterTrigger: 5 } },
      channels: [{ dischargedBy: 'provider', id: 'pt-at', unit: 'document' }],
    };
    expect(() => assertValidReportingObligation(minimal, CONTEXT)).not.toThrow();
  });

  const refusals: [string, (o: Loose) => void, RegExp][] = [
    ['a missing id', (o) => delete o.id, /missing its "id"/],
    ['a blank id', (o) => (o.id = '  '), /missing its "id"/],
    ['a lowercase authority country', (o) => (o.authority.countryCode = 'de'), /authority\.countryCode/],
    ['a missing authority', (o) => delete o.authority, /authority\.countryCode/],
    ['an empty authority name', (o) => (o.authority.name = ' '), /empty "authority\.name"/],
    ['an unknown kind', (o) => (o.kind = 'notice'), /unknown "kind" "notice"/],
    ['an unknown trigger', (o) => (o.trigger = 'paid'), /unknown "trigger" "paid"/],
    ['no document types', (o) => (o.scope.documentTypes = []), /no "scope\.documentTypes"/],
    ['a missing scope', (o) => delete o.scope, /no "scope\.documentTypes"/],
    ['an unknown document type', (o) => (o.scope.documentTypes = ['quote']), /unknown document type "quote"/],
    [
      'a document type listed twice',
      (o) => (o.scope.documentTypes = ['invoice', 'invoice']),
      /document type twice/,
    ],
    ['an empty transaction list', (o) => (o.scope.transactions = []), /"scope\.transactions" that is not/],
    [
      'an unknown transaction category',
      (o) => (o.scope.transactions = [{ transactions: 'b2g' }]),
      /unknown scope transaction category "b2g"/,
    ],
    [
      'an unknown buyer establishment',
      (o) => (o.scope.transactions = [{ transactions: 'b2c', buyerEstablishment: 'abroad' }]),
      /unknown "scope\.buyerEstablishment"/,
    ],
    [
      'empty seller conditions',
      (o) => (o.sellerConditions = { companyProfile: {} }),
      /"sellerConditions\.companyProfile" must be a non-empty object/,
    ],
    [
      'a seller condition with no values',
      (o) => (o.sellerConditions = { companyProfile: { sizeCategory: [] } }),
      /condition "sizeCategory" has no non-empty value list/,
    ],
    [
      'a seller condition with a blank value',
      (o) => (o.sellerConditions = { companyProfile: { sizeCategory: [''] } }),
      /condition "sizeCategory" holds an empty or non-string value/,
    ],
    ['an empty applicability list', (o) => (o.applicability = []), /"applicability" that is not/],
    ['a window with no start', (o) => delete o.applicability[0].from, /applicability window with no "from"/],
    [
      'a window with a malformed start',
      (o) => (o.applicability[0].from = '01/01/2020'),
      /"from" is not a YYYY-MM-DD/,
    ],
    [
      'a window with an impossible date',
      (o) => (o.applicability[0].from = '2026-02-30'),
      /"from" is not a YYYY-MM-DD/,
    ],
    [
      'a window ending before it starts',
      (o) => (o.applicability[0].until = '2019-12-31'),
      /"until" \(2019-12-31\) is not after "from"/,
    ],
    [
      'a window with an empty profile condition',
      (o) => (o.applicability[0].when = { companyProfile: {} }),
      /"applicability\.when\.companyProfile" must be a non-empty object/,
    ],
    ['no legal basis', (o) => delete o.legalBasis, /no "legalBasis"/],
    [
      'a legal basis with no citation',
      (o) => (o.legalBasis.provenance = { kind: 'legal', sourceCheckedAt: '2026-11-13' }),
      /legal basis claims "legal" provenance but is missing sourceText/,
    ],
    [
      'a legal basis valid until before it is valid from',
      (o) => (o.legalBasis.validUntil = '2009-01-01'),
      /"validUntil" \(2009-01-01\) is not after "validFrom"/,
    ],
    [
      'timing with both forms',
      (o) => (o.timing = { period: 'month', deadline: { daysAfterTrigger: 1 } }),
      /exactly one/,
    ],
    ['empty timing', (o) => (o.timing = {}), /exactly one/],
    ['an unknown period', (o) => (o.timing = { period: 'week' }), /unknown "timing\.period" "week"/],
    [
      'a negative deadline',
      (o) => {
        o.timing = { deadline: { daysAfterTrigger: -1 } };
        o.trigger = 'sent';
        o.channels = [{ dischargedBy: 'provider', id: 'p', unit: 'document' }];
      },
      /"daysAfterTrigger" is not a non-negative integer/,
    ],
    [
      'a deadline day past the 28th',
      (o) => {
        o.timing = { deadline: { monthsAfterTrigger: 1, dayOfMonth: 31 } };
        o.trigger = 'sent';
        o.channels = [{ dischargedBy: 'provider', id: 'p', unit: 'document' }];
      },
      /"dayOfMonth" is not an integer from 1 to 28/,
    ],
    [
      'a negative month offset',
      (o) => {
        o.timing = { deadline: { monthsAfterTrigger: -1, dayOfMonth: 5 } };
        o.trigger = 'sent';
        o.channels = [{ dischargedBy: 'provider', id: 'p', unit: 'document' }];
      },
      /"monthsAfterTrigger" is not a non-negative integer/,
    ],
    [
      'a deadline mixing both forms',
      (o) => {
        o.timing = { deadline: { daysAfterTrigger: 3, dayOfMonth: 5 } };
        o.trigger = 'sent';
        o.channels = [{ dischargedBy: 'provider', id: 'p', unit: 'document' }];
      },
      /neither \{ "daysAfterTrigger" \} nor/,
    ],
    [
      'a day of month with no month offset',
      (o) => {
        o.timing = { deadline: { dayOfMonth: 5 } };
        o.trigger = 'sent';
        o.channels = [{ dischargedBy: 'provider', id: 'p', unit: 'document' }];
      },
      /neither \{ "daysAfterTrigger" \} nor/,
    ],
    ['an empty timing note', (o) => (o.timingNote = ''), /empty "timingNote"/],
    ['no channels', (o) => (o.channels = []), /no "channels"/],
    [
      'an unknown discharger',
      (o) => (o.channels[0].dischargedBy = 'email'),
      /unknown "dischargedBy" "email"/,
    ],
    ['a channel with no id', (o) => (o.channels[0].id = ''), /"export" channel with no "id"/],
    ['an unknown unit', (o) => (o.channels[0].unit = 'batch'), /unknown "unit" "batch"/],
    [
      'an empty platform id',
      (o) => (o.channels[0].platformId = ' '),
      /channel "zm-csv" has an empty "platformId"/,
    ],
    [
      'the same channel twice',
      (o) => (o.channels[1] = { ...o.channels[0] }),
      /channel "export:zm-csv" twice/,
    ],
    [
      'a per-period channel without a period',
      (o) => (o.timing = { deadline: { daysAfterTrigger: 10 } }),
      /is per period but the obligation declares no "timing\.period"/,
    ],
    [
      'a per-document channel on a period-end trigger',
      (o) => (o.channels[0].unit = 'document'),
      /is per document but the obligation is triggered at period end/,
    ],
  ];

  it.each(refusals)('refuses %s', (_label, change, message) => {
    let thrown: unknown;
    try {
      assertValidReportingObligation(withChange(change), CONTEXT);
    } catch (error) {
      thrown = error;
    }
    // Provenance and scope-entry rules are shared with the legacy validator and keep its error class.
    expect(thrown).toBeInstanceOf(Error);
    expect([InvalidReportingObligationError, InvalidReportingObligationProvenanceError]).toContain(
      (thrown as Error).constructor,
    );
    expect((thrown as Error).message).toMatch(message);
    expect((thrown as Error).message).toContain(CONTEXT);
  });

  it('refuses a file that uses one obligation id twice', () => {
    const file: CountryReportingObligationFileV2 = { countryCode: 'DE', obligations: [valid(), valid()] };
    expect(() => assertValidReportingObligationFileV2(file, CONTEXT)).toThrow(
      new InvalidReportingObligationError(`${CONTEXT}: obligation id "vies:summary" is used twice.`),
    );
  });

  it('refuses a file with no valid country code', () => {
    expect(() =>
      assertValidReportingObligationFileV2({ countryCode: 'DEU', obligations: [] }, CONTEXT),
    ).toThrow(InvalidReportingObligationError);
  });
});

describe('upgradeLegacyFacts', () => {
  // The legacy facts as they last shipped, frozen when #768 rewrote the country files in v2.
  const byCountry = Object.fromEntries(LEGACY_REPORTING_FILES.map((f) => [f.countryCode, f]));

  it('upgrades every formerly shipped legacy file into a valid v2 file', () => {
    expect(LEGACY_REPORTING_FILES.length).toBeGreaterThan(0);
    for (const file of LEGACY_REPORTING_FILES) {
      const upgraded = upgradeLegacyFacts(file);
      expect(upgraded.countryCode).toBe(file.countryCode);
      expect(upgraded.obligations).toHaveLength(file.facts.length);
    }
  });

  it('keeps every Portuguese fact as a per-document obligation sent through its provider', () => {
    const upgraded = upgradeLegacyFacts(byCountry.PT);
    expect(upgraded.obligations.map((o) => [o.id, o.kind, o.trigger, o.scope, o.channels])).toEqual([
      [
        'pt-at:invoice',
        'data',
        'sent',
        { documentTypes: ['invoice'] },
        [{ dischargedBy: 'provider', id: 'pt-at', unit: 'document' }],
      ],
      [
        'pt-at:credit-note',
        'data',
        'sent',
        { documentTypes: ['credit-note'] },
        [{ dischargedBy: 'provider', id: 'pt-at', unit: 'document' }],
      ],
    ]);
    expect(upgraded.obligations.every((o) => o.authority.countryCode === 'PT')).toBe(true);
  });

  it('keeps the French transport fact, the B2C fact and the payment fact apart, with their windows', () => {
    const legacy = byCountry.FR;
    const upgraded = upgradeLegacyFacts(legacy);
    expect(upgraded.obligations.map((o) => [o.id, o.trigger, o.channels[0].dischargedBy])).toEqual([
      ['pdp:invoice:b2b-domestic', 'sent', 'transport'],
      ['fr-pa:invoice:b2c', 'sent', 'provider'],
      ['fr-pa:invoice:payments', 'payment', 'provider'],
    ]);
    // One accredited platform behind both registry ids: the transport channel names it.
    expect(upgraded.obligations.map((o) => o.channels[0].platformId)).toEqual([
      'fr-pa',
      undefined,
      undefined,
    ]);
    legacy.facts.forEach((fact, index) => {
      const obligation = upgraded.obligations[index];
      expect(obligation.scope.transactions).toEqual(fact.scope);
      expect(obligation.legalBasis.provenance).toBe(fact.provenance);
      expect(obligation.notes).toBe(fact.notes);
      expect(obligation.timingNote).toBe(fact.periodicity);
      expect(obligation.applicability?.map((w) => [w.from, w.when?.companyProfile])).toEqual(
        fact.applicability?.map((w) => [w.from.date, w.when?.companyProfile]),
      );
    });
  });

  // Issue #768 rewrote the country files through this very upgrade. The only hand edit is Portugal's
  // trigger: the AT communication is due once the document is issued, not when it is sent, so both
  // its obligations moved to "issued" with a timing note saying so; the remainder of #768 then gave
  // them the deadline that note states (the 5th of the following month, `periods.ts`). Anything else
  // drifting fails here.
  it('the shipped v2 files are the upgrade of the legacy facts, but for the Portuguese trigger and deadline', () => {
    const shipped = Object.fromEntries(ALL_REPORTING_OBLIGATION_FILES.map((f) => [f.countryCode, f]));
    expect(shipped.FR).toEqual(upgradeLegacyFacts(byCountry.FR));
    const upgradedPt = upgradeLegacyFacts(byCountry.PT);
    expect(shipped.PT.obligations.map((o) => [o.trigger, o.timingNote, o.timing])).toEqual(
      upgradedPt.obligations.map(() => [
        'issued',
        expect.stringContaining('DL 198/2012, art. 3'),
        { deadline: { monthsAfterTrigger: 1, dayOfMonth: 5 } },
      ]),
    );
    expect(shipped.PT.obligations.map(({ trigger, timingNote, timing, ...rest }) => rest)).toEqual(
      upgradedPt.obligations.map(({ trigger, timingNote, timing, ...rest }) => rest),
    );
  });

  it('carries a single applicableFrom over as an unconditioned window', () => {
    const upgraded = upgradeLegacyFacts({
      countryCode: 'PT',
      facts: [
        {
          providerId: 'pt-at',
          appliesTo: 'invoice',
          dischargedBy: 'provider',
          applicableFrom: { date: '2013-01-01', provenance: legal },
          provenance: legal,
        },
      ],
    });
    expect(upgraded.obligations[0].applicability).toEqual([{ from: '2013-01-01', provenance: legal }]);
  });

  it('refuses a legacy fact that mixes payments with document categories', () => {
    expect(() =>
      upgradeLegacyFacts({
        countryCode: 'FR',
        facts: [
          {
            providerId: 'fr-pa',
            appliesTo: 'invoice',
            dischargedBy: 'provider',
            scope: [{ transactions: 'b2c' }, { transactions: 'payments' }],
            provenance: legal,
          },
        ],
      }),
    ).toThrow(LegacyReportingUpgradeError);
  });

  it('refuses two legacy facts that would upgrade to the same id', () => {
    const fact = {
      providerId: 'pt-at',
      appliesTo: 'invoice' as const,
      dischargedBy: 'provider' as const,
      provenance: legal,
    };
    expect(() => upgradeLegacyFacts({ countryCode: 'PT', facts: [fact, fact] })).toThrow(
      /"pt-at:invoice" is used twice/,
    );
  });
});
