/**
 * P2-T01 (A3) — an unresolved attachment blocks; it does not become France.
 *
 * `buildComplianceContext` used to end both country resolutions with `?? 'FR'`. That is not a
 * default value, it is a verdict: CGI art. 289 bis I makes the attachment of BOTH parties the
 * trigger for the French e-invoicing mandate (Légifrance, consulted 2026-08-28 — see
 * docs/compliance/FR-RATTACHEMENT.md), so a company with no country set was silently told it must
 * issue through a PDP, and a country-less client silently became a domestic French buyer.
 *
 * The buyer side had a guard at issuance (F-006) but the CONTEXT BUILDER still fell back, and the
 * supplier side had no guard at all.
 */
import { BadRequestException } from '@nestjs/common';
import { buildComplianceContext } from './invoices.helpers';

const opts = {
  lines: [],
  issueDate: new Date('2027-01-15'),
  currency: 'EUR',
  externalRef: 'FA-1',
};

const company = (over: Record<string, unknown> = {}) =>
  ({ id: 'co-1', name: 'Acme', countryCode: 'FR', country: 'France', partyIdentifiers: [], ...over }) as never;

const client = (over: Record<string, unknown> = {}) =>
  ({ id: 'cl-1', name: 'Buyer', countryCode: 'FR', country: 'France', type: 'COMPANY', partyIdentifiers: [], ...over }) as never;

describe('P2-T01 — an unresolved country blocks instead of defaulting to France', () => {
  it('both countries resolved: the context is built', () => {
    const ctx = buildComplianceContext(company(), client(), opts);
    expect(ctx.supplier.countryCode).toBe('FR');
    expect(ctx.buyer.countryCode).toBe('FR');
  });

  it('the supplier country is unresolved: it throws, naming the company', () => {
    expect(() =>
      buildComplianceContext(company({ countryCode: null, country: null }), client(), opts),
    ).toThrow(BadRequestException);
    expect(() =>
      buildComplianceContext(company({ countryCode: null, country: null }), client(), opts),
    ).toThrow(/company's country/i);
  });

  it('the buyer country is unresolved: it throws, naming the client', () => {
    expect(() =>
      buildComplianceContext(company(), client({ countryCode: null, country: null }), opts),
    ).toThrow(/client's country/i);
  });

  /**
   * The regression this pins. With `?? 'FR'`, a company and client with NO country at all produced
   * a perfectly well-formed French domestic context — supplier FR, buyer FR — and the engine went
   * on to resolve DECENTRALIZED_CTC and a PDP channel for it. Nothing anywhere said a field was
   * missing.
   */
  it('neither country resolved: it throws rather than producing a French domestic operation', () => {
    let ctx: unknown;
    expect(() => {
      ctx = buildComplianceContext(
        company({ countryCode: null, country: null }),
        client({ countryCode: null, country: null }),
        opts,
      );
    }).toThrow(BadRequestException);
    expect(ctx).toBeUndefined();
  });

  it('a free-text country still resolves — the guard blocks the UNRESOLVABLE, not the unformatted', () => {
    const ctx = buildComplianceContext(
      company({ countryCode: null, country: 'Allemagne' }),
      client({ countryCode: null, country: 'Italy' }),
      opts,
    );
    expect(ctx.supplier.countryCode).toBe('DE');
    expect(ctx.buyer.countryCode).toBe('IT');
  });
});
