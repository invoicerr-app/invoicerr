/**
 * The classifier against the REAL French country file, never a hand-built copy: a rule that drifted
 * from `countries/data/fr.json` would pass a fixture forever while declaring the wrong operations.
 */
import { describe, expect, it } from 'vitest';

import { LEGACY_REPORTING_FILES } from './__fixtures__/legacy-reporting-files';
import { ALL_REPORTING_OBLIGATION_FILES } from './data/all';
import { classifyDeclaration, classifyObligation, DeclarationOperation } from './classify';
import { ReportingObligation, upgradeLegacyFacts } from './obligation-v2';

const FR = ALL_REPORTING_OBLIGATION_FILES.find((file) => file.countryCode === 'FR');
if (!FR) throw new Error('The French reporting file is missing.');

function frObligation(id: string): ReportingObligation {
  const found = FR?.obligations.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`The French reporting file has no "${id}" obligation.`);
  return found;
}
const b2cObligation = frObligation('fr-pa:invoice:b2c');
const paymentObligation = frObligation('fr-pa:invoice:payments');

function operation(overrides: Partial<DeclarationOperation> = {}): DeclarationOperation {
  return {
    kind: 'invoice',
    sellerCountryCode: 'FR',
    buyerType: 'INDIVIDUAL',
    buyerCountryCode: 'FR',
    documentIssueDate: '2027-10-01',
    companyProfile: { sizeCategory: 'SME', vatGroupMember: 'NOT_MEMBER', vatRegime: 'REAL_MONTHLY' },
    vatOnCollection: true,
    lineNatures: ['service'],
    ...overrides,
  };
}

describe('classifyObligation  -  the French B2C obligation', () => {
  it('is in for a domestic sale to a private buyer once the company is bound', () => {
    expect(classifyObligation(b2cObligation, operation()).status).toBe('in');
  });

  it('is out for a business buyer, domestic or foreign (international B2B is a follow-up slice)', () => {
    expect(classifyObligation(b2cObligation, operation({ buyerType: 'COMPANY' })).status).toBe('out');
    expect(
      classifyObligation(b2cObligation, operation({ buyerType: 'COMPANY', buyerCountryCode: 'DE' })).status,
    ).toBe('out');
  });

  it('is out for a business buyer even when the seller size category is undeclared', () => {
    expect(
      classifyObligation(b2cObligation, operation({ buyerType: 'COMPANY', companyProfile: {} })).status,
    ).toBe('out');
  });

  it('is undetermined when the client has no type, never guessed as B2C', () => {
    expect(classifyObligation(b2cObligation, operation({ buyerType: undefined })).status).toBe(
      'undetermined',
    );
  });

  it('is undetermined when the buyer country cannot be resolved', () => {
    expect(classifyObligation(b2cObligation, operation({ buyerCountryCode: undefined })).status).toBe(
      'undetermined',
    );
  });

  it('is in for a seller under the franchise en base (art. 293 B is not an art. 261 exemption)', () => {
    expect(
      classifyObligation(
        b2cObligation,
        operation({
          companyProfile: { sizeCategory: 'LARGE', vatRegime: 'FRANCHISE' },
          vatOnCollection: false,
        }),
      ).status,
    ).toBe('in');
  });
});

describe('classifyObligation  -  the size-tiered calendar', () => {
  it('binds a large company from 2026-09-01', () => {
    expect(
      classifyObligation(
        b2cObligation,
        operation({ documentIssueDate: '2026-09-01', companyProfile: { sizeCategory: 'LARGE' } }),
      ).status,
    ).toBe('in');
  });

  it('binds an SME from 2027-09-01 and leaves it out before that date', () => {
    const sme = operation({
      documentIssueDate: '2027-08-31',
      companyProfile: { sizeCategory: 'SME', vatGroupMember: 'NOT_MEMBER' },
    });
    expect(classifyObligation(b2cObligation, sme).status).toBe('out');
    expect(classifyObligation(b2cObligation, { ...sme, documentIssueDate: '2027-09-01' }).status).toBe('in');
  });

  it('binds a member of an assujetti unique from 2026-09-01 whatever its size', () => {
    expect(
      classifyObligation(
        b2cObligation,
        operation({
          documentIssueDate: '2026-09-01',
          companyProfile: { sizeCategory: 'MICRO', vatGroupMember: 'MEMBER' },
        }),
      ).status,
    ).toBe('in');
  });

  it('is undetermined without a company size category, never declared on a guess', () => {
    const verdict = classifyObligation(b2cObligation, operation({ companyProfile: {} }));
    expect(verdict.status).toBe('undetermined');
    if (verdict.status === 'undetermined') expect(verdict.reason).toContain('sizeCategory');
  });

  it('is undetermined for an SME whose VAT-group membership is undeclared', () => {
    expect(
      classifyObligation(b2cObligation, operation({ companyProfile: { sizeCategory: 'SME' } })).status,
    ).toBe('undetermined');
  });
});

describe('classifyObligation  -  payment data (CGI art. 290 A)', () => {
  const payment = (overrides: Partial<DeclarationOperation> = {}) =>
    operation({ kind: 'payment', payment: { amountMinor: 12000, paidAt: '2027-10-05' }, ...overrides });

  it('is in for a B2C service payment when VAT is due on collection', () => {
    expect(classifyObligation(paymentObligation, payment()).status).toBe('in');
  });

  it('is out when the company opted for VAT on debits', () => {
    expect(classifyObligation(paymentObligation, payment({ vatOnCollection: false })).status).toBe('out');
  });

  it('is out for a goods-only invoice', () => {
    expect(classifyObligation(paymentObligation, payment({ lineNatures: ['goods'] })).status).toBe('out');
  });

  it('is undetermined when a line has no article, so its nature is unknown', () => {
    expect(classifyObligation(paymentObligation, payment({ lineNatures: undefined })).status).toBe(
      'undetermined',
    );
  });

  it('is out for a business buyer in slice 1', () => {
    expect(classifyObligation(paymentObligation, payment({ buyerType: 'COMPANY' })).status).toBe('out');
  });

  it('is out for a business buyer even when the seller size category is undeclared', () => {
    expect(
      classifyObligation(paymentObligation, payment({ buyerType: 'COMPANY', companyProfile: {} })).status,
    ).toBe('out');
  });

  it('is out for a seller under the franchise en base, pending counsel on art. 290 A', () => {
    const verdict = classifyObligation(
      paymentObligation,
      payment({ companyProfile: { sizeCategory: 'LARGE', vatRegime: 'FRANCHISE' }, vatOnCollection: false }),
    );
    expect(verdict.status).toBe('out');
    expect(verdict.reason).toContain('franchise');
  });

  it('does not fire the payment fact on the invoice trigger', () => {
    expect(classifyObligation(paymentObligation, operation()).status).toBe('out');
  });

  it('does not fire the invoice fact on the payment trigger', () => {
    expect(classifyObligation(b2cObligation, payment()).status).toBe('out');
  });
});

/**
 * The v2 entry point (issue #767), pinned against the legacy one: for every shipped fact, its upgraded
 * obligation gets the same verdict, reason included, on every operation of a grid that crosses each
 * input the classifier reads. Switching a trigger from facts to obligations is then behaviour-preserving.
 */
describe('classifyObligation  -  the same verdict as classifyDeclaration on every shipped fact', () => {
  const profiles: Record<string, string>[] = [
    {},
    { sizeCategory: 'SME', vatGroupMember: 'NOT_MEMBER', vatRegime: 'REAL_MONTHLY' },
    { sizeCategory: 'LARGE' },
    { vatGroupMember: 'MEMBER' },
    { sizeCategory: 'MICRO', vatRegime: 'FRANCHISE' },
  ];
  const grid: (DeclarationOperation | undefined)[] = [undefined];
  for (const kind of ['invoice', 'payment'] as const)
    for (const buyerType of ['INDIVIDUAL', 'COMPANY', undefined] as const)
      for (const buyerCountryCode of ['FR', 'DE', undefined])
        for (const documentIssueDate of ['2026-08-01', '2026-10-01', '2027-10-01'])
          for (const companyProfile of profiles)
            for (const vatOnCollection of [true, false])
              for (const lineNatures of [['service'], ['goods'], undefined] as const)
                grid.push({
                  kind,
                  sellerCountryCode: 'FR',
                  buyerType,
                  buyerCountryCode,
                  documentIssueDate,
                  companyProfile,
                  vatOnCollection,
                  lineNatures: lineNatures && [...lineNatures],
                  ...(kind === 'payment'
                    ? { payment: { amountMinor: 1000, paidAt: documentIssueDate } }
                    : {}),
                });

  // The legacy facts as they last shipped (frozen by #768, which rewrote the country files in v2).
  const cases = LEGACY_REPORTING_FILES.flatMap((file) =>
    file.facts.map((fact, index) => ({
      label: `${file.countryCode} ${fact.providerId}/${fact.appliesTo} #${index}`,
      fact,
      obligation: upgradeLegacyFacts(file).obligations[index],
    })),
  );

  it('covers at least one scoped and one unscoped fact', () => {
    expect(cases.some((c) => c.fact.scope)).toBe(true);
    expect(cases.some((c) => !c.fact.scope && !c.fact.applicability)).toBe(true);
  });

  it.each(cases)('$label', ({ fact, obligation }) => {
    for (const operation of grid) {
      expect(classifyObligation(obligation, operation)).toEqual(classifyDeclaration(fact, operation));
    }
  });
});

describe('classifyObligation  -  what only v2 can say', () => {
  const provenance = { kind: 'unverified' as const, resolutionNote: 'fixture' };
  const base: ReportingObligation = {
    id: 'zz-data',
    authority: { countryCode: 'ZZ' },
    kind: 'data',
    trigger: 'sent',
    scope: { documentTypes: ['invoice'] },
    legalBasis: { provenance },
    channels: [{ dischargedBy: 'provider', id: 'zz-api', unit: 'document' }],
  };

  it('an obligation with no scope, window or seller condition needs no operation', () => {
    expect(classifyObligation(base, undefined)).toEqual({ status: 'in', scope: 'all' });
  });

  it('a window is open from its first day and closed from its "until" day', () => {
    const windowed = { ...base, applicability: [{ from: '2026-01-01', until: '2027-01-01', provenance }] };
    expect(classifyObligation(windowed, operation({ documentIssueDate: '2025-12-31' })).status).toBe('out');
    expect(classifyObligation(windowed, operation({ documentIssueDate: '2026-01-01' })).status).toBe('in');
    expect(classifyObligation(windowed, operation({ documentIssueDate: '2026-12-31' })).status).toBe('in');
    const closed = classifyObligation(windowed, operation({ documentIssueDate: '2027-01-01' }));
    expect(closed).toEqual({
      status: 'out',
      reason: 'This obligation ended on 2027-01-01 for this company.',
    });
  });

  it('a seller condition: in when met, out when not, undetermined when the profile lacks the key', () => {
    const conditioned = { ...base, sellerConditions: { companyProfile: { vatRegime: ['REAL_MONTHLY'] } } };
    expect(classifyObligation(conditioned, operation()).status).toBe('in');
    expect(
      classifyObligation(conditioned, operation({ companyProfile: { vatRegime: 'REAL_QUARTERLY' } })).status,
    ).toBe('out');
    expect(classifyObligation(conditioned, operation({ companyProfile: {} }))).toEqual({
      status: 'undetermined',
      reason: 'The company has not declared "vatRegime", which decides whether this obligation applies.',
    });
    expect(classifyObligation(conditioned, undefined).status).toBe('undetermined');
  });
});
