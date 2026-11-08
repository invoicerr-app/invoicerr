/**
 * The classifier against the REAL French country file, never a hand-built copy: a rule that drifted
 * from `countries/data/fr.json` would pass a fixture forever while declaring the wrong operations.
 */
import { describe, expect, it } from 'vitest';

import { ALL_REPORTING_OBLIGATION_FILES } from './data/all';
import { classifyDeclaration, DeclarationOperation } from './classify';
import { ReportingObligationFact } from './schema';

const FR = ALL_REPORTING_OBLIGATION_FILES.find((file) => file.countryCode === 'FR');
if (!FR) throw new Error('The French reporting file is missing.');

const b2cFact = FR.facts.find(
  (fact) => fact.providerId === 'fr-pa' && fact.scope?.some((entry) => entry.transactions === 'b2c'),
) as ReportingObligationFact;
const paymentFact = FR.facts.find(
  (fact) => fact.providerId === 'fr-pa' && fact.scope?.some((entry) => entry.transactions === 'payments'),
) as ReportingObligationFact;

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

describe('classifyDeclaration  -  the French B2C fact', () => {
  it('is in for a domestic sale to a private buyer once the company is bound', () => {
    expect(classifyDeclaration(b2cFact, operation()).status).toBe('in');
  });

  it('is out for a business buyer, domestic or foreign (international B2B is a follow-up slice)', () => {
    expect(classifyDeclaration(b2cFact, operation({ buyerType: 'COMPANY' })).status).toBe('out');
    expect(
      classifyDeclaration(b2cFact, operation({ buyerType: 'COMPANY', buyerCountryCode: 'DE' })).status,
    ).toBe('out');
  });

  it('is out for a business buyer even when the seller size category is undeclared', () => {
    expect(classifyDeclaration(b2cFact, operation({ buyerType: 'COMPANY', companyProfile: {} })).status).toBe(
      'out',
    );
  });

  it('is undetermined when the client has no type, never guessed as B2C', () => {
    expect(classifyDeclaration(b2cFact, operation({ buyerType: undefined })).status).toBe('undetermined');
  });

  it('is undetermined when the buyer country cannot be resolved', () => {
    expect(classifyDeclaration(b2cFact, operation({ buyerCountryCode: undefined })).status).toBe(
      'undetermined',
    );
  });

  it('is out for an exempt seller (franchise en base)', () => {
    expect(
      classifyDeclaration(b2cFact, operation({ companyProfile: { vatRegime: 'FRANCHISE' } })).status,
    ).toBe('out');
  });
});

describe('classifyDeclaration  -  the size-tiered calendar', () => {
  it('binds a large company from 2026-09-01', () => {
    expect(
      classifyDeclaration(
        b2cFact,
        operation({ documentIssueDate: '2026-09-01', companyProfile: { sizeCategory: 'LARGE' } }),
      ).status,
    ).toBe('in');
  });

  it('binds an SME from 2027-09-01 and leaves it out before that date', () => {
    const sme = operation({
      documentIssueDate: '2027-08-31',
      companyProfile: { sizeCategory: 'SME', vatGroupMember: 'NOT_MEMBER' },
    });
    expect(classifyDeclaration(b2cFact, sme).status).toBe('out');
    expect(classifyDeclaration(b2cFact, { ...sme, documentIssueDate: '2027-09-01' }).status).toBe('in');
  });

  it('binds a member of an assujetti unique from 2026-09-01 whatever its size', () => {
    expect(
      classifyDeclaration(
        b2cFact,
        operation({
          documentIssueDate: '2026-09-01',
          companyProfile: { sizeCategory: 'MICRO', vatGroupMember: 'MEMBER' },
        }),
      ).status,
    ).toBe('in');
  });

  it('is undetermined without a company size category, never declared on a guess', () => {
    const verdict = classifyDeclaration(b2cFact, operation({ companyProfile: {} }));
    expect(verdict.status).toBe('undetermined');
    if (verdict.status === 'undetermined') expect(verdict.reason).toContain('sizeCategory');
  });

  it('is undetermined for an SME whose VAT-group membership is undeclared', () => {
    expect(classifyDeclaration(b2cFact, operation({ companyProfile: { sizeCategory: 'SME' } })).status).toBe(
      'undetermined',
    );
  });
});

describe('classifyDeclaration  -  payment data (CGI art. 290 A)', () => {
  const payment = (overrides: Partial<DeclarationOperation> = {}) =>
    operation({ kind: 'payment', payment: { amountMinor: 12000, paidAt: '2027-10-05' }, ...overrides });

  it('is in for a B2C service payment when VAT is due on collection', () => {
    expect(classifyDeclaration(paymentFact, payment()).status).toBe('in');
  });

  it('is out when the company opted for VAT on debits', () => {
    expect(classifyDeclaration(paymentFact, payment({ vatOnCollection: false })).status).toBe('out');
  });

  it('is out for a goods-only invoice', () => {
    expect(classifyDeclaration(paymentFact, payment({ lineNatures: ['goods'] })).status).toBe('out');
  });

  it('is undetermined when a line has no article, so its nature is unknown', () => {
    expect(classifyDeclaration(paymentFact, payment({ lineNatures: undefined })).status).toBe('undetermined');
  });

  it('is out for a business buyer in slice 1', () => {
    expect(classifyDeclaration(paymentFact, payment({ buyerType: 'COMPANY' })).status).toBe('out');
  });

  it('is out for a business buyer even when the seller size category is undeclared', () => {
    expect(
      classifyDeclaration(paymentFact, payment({ buyerType: 'COMPANY', companyProfile: {} })).status,
    ).toBe('out');
  });

  it('does not fire the payment fact on the invoice trigger', () => {
    expect(classifyDeclaration(paymentFact, operation()).status).toBe('out');
  });

  it('does not fire the invoice fact on the payment trigger', () => {
    expect(classifyDeclaration(b2cFact, payment()).status).toBe('out');
  });
});
