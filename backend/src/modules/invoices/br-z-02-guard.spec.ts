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
const BUYER_VAT_ID = { scheme: 'VAT', value: 'BE0123456789' };
const BUYER_LEGAL_ID = { scheme: 'LEGAL_ID', value: 'BE-987654321' };

const company = (identifiers: Array<{ scheme: string; value: string }>) =>
  ({
    id: 'co-1',
    name: 'Acme',
    countryCode: 'FR',
    country: 'France',
    partyIdentifiers: identifiers,
  }) as never;

// The buyer defaults to a VAT identifier so the seller-side cases below isolate the seller half.
// Before the buyer rules existed this fixture had NO identifiers at all — an entity that cannot
// legally receive an AE or K invoice, which is how the buyer half stayed untested.
const client = (identifiers: Array<{ scheme: string; value: string }> = [BUYER_VAT_ID]) =>
  ({ id: 'cl-1', name: 'Buyer', countryCode: 'BE', type: 'COMPANY', partyIdentifiers: identifiers }) as never;

const check = (identifiers: Array<{ scheme: string; value: string }>, categories: string[]) => () =>
  resolveZeroRatedSellerVatOrThrow(company(identifiers), client(), categories);

const checkBuyer = (identifiers: Array<{ scheme: string; value: string }>, categories: string[]) => () =>
  resolveZeroRatedSellerVatOrThrow(company([VAT_ID]), client(identifiers), categories);

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

/**
 * The BUYER half of the same two rules, read from the same Schematron as the seller half.
 *
 * The seller guard shipped alone and looked complete: five categories, six rules cited, a spec per
 * case. But two of those six rules have a second conjunct. BR-AE-02 and BR-IC-02 are `(seller …)
 * and (buyer …)` — an invoice can satisfy everything the guard checked and still be refused at
 * transmission for the half nobody read. The seller half being right is what made that easy to miss.
 *
 *   AE  BR-AE-02  `BuyerTradeParty/SpecifiedTaxRegistration/ID[@schemeID='VA']`
 *                 OR `BuyerTradeParty/SpecifiedLegalOrganization/ID`
 *   K   BR-IC-02  `BuyerTradeParty/SpecifiedTaxRegistration/ID[@schemeID='VA']`, and only that
 *
 * These two are also precisely the categories C4 just made reachable: before the VAT validation
 * verdict was wired, no invoice could resolve to AE or K at all, so the buyer rules could not fire
 * in production even had they been implemented. Fixing the routing is what turned them into live code.
 */
describe('BR-AE-02 / BR-IC-02 — the buyer identifier the seller guard did not check', () => {
  it.each(['AE', 'K'])('%s is blocked when the client has no identifier', (cat) => {
    expect(checkBuyer([], [cat])).toThrow(BadRequestException);
    expect(checkBuyer([], [cat])).toThrow(/client's/);
  });

  it.each(['AE', 'K'])("%s passes on the client's VAT identifier", (cat) => {
    expect(checkBuyer([BUYER_VAT_ID], [cat])).not.toThrow();
  });

  it('AE also accepts a legal registration identifier — BR-AE-02 offers the alternative', () => {
    expect(checkBuyer([BUYER_LEGAL_ID], ['AE'])).not.toThrow();
  });

  it('K does NOT accept it — BR-IC-02 names the VAT identifier and nothing else', () => {
    expect(checkBuyer([BUYER_LEGAL_ID], ['K'])).toThrow(/BR-IC-02/);
  });

  it.each(['Z', 'E', 'G'])('%s asks nothing of the buyer — refusing there would over-block', (cat) => {
    expect(checkBuyer([], [cat])).not.toThrow();
  });

  it('an empty value is not an identifier on the buyer side either', () => {
    expect(checkBuyer([{ scheme: 'VAT', value: '' }], ['K'])).toThrow(BadRequestException);
  });

  it('the buyer half is reported first, so one fix per round trip is not the pattern', () => {
    // Both halves missing: the user should learn about the client, then the company — not discover
    // the second wall after saving the first fix.
    const bothMissing = () => resolveZeroRatedSellerVatOrThrow(company([]), client([]), ['K']);
    expect(bothMissing).toThrow(/client's/);
  });
});
