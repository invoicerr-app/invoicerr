/**
 * C1 — EN 16931 BR-Z-02, enforced at issuance rather than discovered at transmission.
 *
 * Found on a full e2e run: two French sends were blocked by BR-Z-02 inside an otherwise GREEN
 * suite. The product let a French company exist with no VAT identifier, let an invoice be issued at
 * 0%, and only said so at send — a Schematron error in a server log, nothing the user could act on.
 * The suite passed because no spec asserts that a send succeeds.
 */
import { BadRequestException } from '@nestjs/common';
import { resolveZeroRatedSellerVatOrThrow } from './invoices.helpers';

const company = (over: Record<string, unknown> = {}) =>
  ({
    id: 'co-1',
    name: 'Acme',
    countryCode: 'FR',
    country: 'France',
    partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
    ...over,
  }) as never;

const client = (over: Record<string, unknown> = {}) =>
  ({ id: 'cl-1', name: 'Buyer', countryCode: 'FR', country: 'France', type: 'COMPANY', ...over }) as never;

describe('C1 — BR-Z-02: a zero-rated French line needs the seller VAT identifier', () => {
  it('blocks the exact case observed in the e2e run: FR→FR, 0%, no VAT id', () => {
    expect(() =>
      resolveZeroRatedSellerVatOrThrow(company({ partyIdentifiers: [] }), client(), [0]),
    ).toThrow(BadRequestException);
  });

  it('names the rule and both ways out, so the message is actionable', () => {
    try {
      resolveZeroRatedSellerVatOrThrow(company({ partyIdentifiers: [] }), client(), [0]);
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('BR-Z-02');
      expect(msg).toMatch(/VAT number/i);
      expect(msg).toMatch(/non-zero VAT rate/i);
    }
  });

  it('allows it once the company has a VAT identifier', () => {
    expect(() => resolveZeroRatedSellerVatOrThrow(company(), client(), [0])).not.toThrow();
  });

  it('a VAT identifier with an empty value does not count', () => {
    expect(() =>
      resolveZeroRatedSellerVatOrThrow(
        company({ partyIdentifiers: [{ scheme: 'VAT', value: '' }] }),
        client(),
        [0],
      ),
    ).toThrow(BadRequestException);
  });

  it('a non-zero rate is unaffected, VAT id or not', () => {
    expect(() =>
      resolveZeroRatedSellerVatOrThrow(company({ partyIdentifiers: [] }), client(), [20]),
    ).not.toThrow();
  });

  it('only one line has to be zero-rated for the rule to bite', () => {
    expect(() =>
      resolveZeroRatedSellerVatOrThrow(company({ partyIdentifiers: [] }), client(), [20, 0]),
    ).toThrow(BadRequestException);
  });

  /**
   * The narrowness is the point. Exports and reverse charge also carry a 0 rate and are governed by
   * BR-IC-02 / BR-AE-02, whose conditions differ. Blocking on "rate is 0" alone would refuse
   * invoices that are perfectly valid, so a cross-border operation is left alone until those rules
   * are read rather than extrapolated.
   */
  it('a cross-border operation is left alone — its zero rate is another rule\'s business', () => {
    expect(() =>
      resolveZeroRatedSellerVatOrThrow(company({ partyIdentifiers: [] }), client({ countryCode: 'DE' }), [0]),
    ).not.toThrow();
  });

  it('a non-French seller is left alone', () => {
    expect(() =>
      resolveZeroRatedSellerVatOrThrow(
        company({ countryCode: 'DE', partyIdentifiers: [] }),
        client({ countryCode: 'DE' }),
        [0],
      ),
    ).not.toThrow();
  });
});
