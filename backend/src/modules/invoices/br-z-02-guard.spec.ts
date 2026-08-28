/**
 * C1 + C3 — the EN 16931 seller-identifier rules for zero-rate VAT categories, at issuance.
 *
 * Found on a full e2e run: French sends blocked by BR-Z-02 inside an otherwise GREEN suite. The
 * product let a company exist with no VAT identifier, let a 0% invoice be issued, and only said so
 * at SEND — a Schematron error in a server log, nothing the user could act on.
 *
 * C1 keyed the guard on "rate is 0", domestic France only. C3 replaced that with the resolved VAT
 * CATEGORY, after reading the six rules out of the vendored Schematron rather than extrapolating
 * from the one that had been observed. They do not agree with each other, and one of them inverts:
 *
 *   Z  BR-Z-02   zero rated             seller VAT id / tax registration id / representative
 *   E  BR-E-02   exempt from VAT        same
 *   AE BR-AE-02  reverse charge         same, plus a buyer identifier
 *   K  BR-IC-02  intra-community        VAT id or representative — NOT a tax registration id
 *   G  BR-G-02   export outside the EU  VAT id or representative — NOT a tax registration id
 *   O  BR-O-02   not subject to VAT     shall NOT contain a seller VAT identifier
 *
 * O is why a rate-based guard is indefensible: 0 rate, and it forbids what the other five require.
 */
import { BadRequestException } from '@nestjs/common';
import { resolveZeroRatedSellerVatOrThrow } from './invoices.helpers';

const VAT_ID = { scheme: 'VAT', value: 'FR12345678901' };
const LEGAL_ID = { scheme: 'LEGAL_ID', value: '123456789' };

const company = (identifiers: Array<{ scheme: string; value: string }>) =>
  ({ id: 'co-1', name: 'Acme', countryCode: 'FR', country: 'France', partyIdentifiers: identifiers }) as never;

const client = () => ({ id: 'cl-1', name: 'Buyer', countryCode: 'FR', type: 'COMPANY' }) as never;

const check = (identifiers: Array<{ scheme: string; value: string }>, categories: string[]) => () =>
  resolveZeroRatedSellerVatOrThrow(company(identifiers), client(), categories);

describe('C1/C3 — the five categories that REQUIRE a seller identifier', () => {
  it.each(['Z', 'E', 'AE', 'K', 'G'])('%s is blocked when the company has no identifier at all', (cat) => {
    expect(check([], [cat])).toThrow(BadRequestException);
  });

  it.each(['Z', 'E', 'AE', 'K', 'G'])('%s passes once the company has a VAT identifier', (cat) => {
    expect(check([VAT_ID], [cat])).not.toThrow();
  });

  it('names the offending category and its rule, so the message is actionable', () => {
    expect(check([], ['AE'])).toThrow(/category "AE"/);
    expect(check([], ['AE'])).toThrow(/BR-AE-02/);
    expect(check([], ['K'])).toThrow(/BR-IC-02/);
  });
});

describe('C3 — a tax registration identifier is accepted by three categories and refused by two', () => {
  it.each(['Z', 'E', 'AE'])('%s accepts a LEGAL_ID in place of the VAT identifier', (cat) => {
    expect(check([LEGAL_ID], [cat])).not.toThrow();
  });

  /**
   * The distinction is in the Schematron, not cosmetic: BR-G-02 and BR-IC-02 accept only the VAT
   * identifier or a tax representative's, where BR-Z-02/E-02/AE-02 also accept a plain tax
   * registration identifier. Flattening the five into one rule would let these two through.
   */
  it.each(['K', 'G'])('%s still refuses a LEGAL_ID — BR-IC-02/BR-G-02 do not accept BT-32', (cat) => {
    expect(check([LEGAL_ID], [cat])).toThrow(BadRequestException);
  });
});

describe('the categories the guard must NOT touch', () => {
  it('O — "not subject to VAT" carries a 0 rate and FORBIDS the seller VAT id (BR-O-02)', () => {
    expect(check([], ['O'])).not.toThrow();
    expect(check([VAT_ID], ['O'])).not.toThrow();
  });

  it('S — the standard rate is unaffected, identifier or not', () => {
    expect(check([], ['S'])).not.toThrow();
  });

  it('one offending line among several is enough for the rule to bite', () => {
    expect(check([], ['S', 'S', 'Z'])).toThrow(BadRequestException);
  });

  it('an empty identifier value does not count as an identifier', () => {
    expect(check([{ scheme: 'VAT', value: '' }], ['Z'])).toThrow(BadRequestException);
  });
});
