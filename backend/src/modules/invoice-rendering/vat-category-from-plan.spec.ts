/**
 * The renderer reads the VAT category from the plan. It used to decide it from the rate, and the
 * two disagreed on three of five cases — this file is what pinned that, and now guards the fix.
 *
 * Found by chasing BR-Z-02 out of a full Cypress run: `08-payments.cy.ts` issues an invoice fine
 * and then gets a 400 on `POST /api/invoices/send`, "[EN16931_CII/AUTHORITATIVE] [BR-Z-02]". The
 * issuance guard could not have caught it, because the guard and the document do not agree about
 * what the invoice IS:
 *
 *   invoice-rendering.service.ts:358   const vatCategoryFor = (rate: number) =>
 *                                        rate !== 0 ? 'S' : isEuReverseCharge ? 'AE' : 'Z'
 *
 * Three outcomes — S, AE, Z — for an engine that produces five. Its own comment lists what it is
 * collapsing: "domestic zero-rating, non-EU export, out-of-scope supply, ... keeps using Z". That
 * is the same defect C1 was, and C3 named: a VAT category is not a function of a rate. It was
 * fixed in the issuance guard and left standing in the renderer, one layer down.
 *
 * The consequence is not cosmetic. For a French supplier billing services to a US business the
 * engine says O — outside the scope of French VAT (CGI art. 259-1°, Directive 2006/112 art. 44).
 * BR-O-02 says such an invoice shall NOT carry the seller's VAT identifier. The renderer writes Z,
 * and BR-Z-02 says it MUST. The document is then unsatisfiable: adding the identifier trips one
 * rule, omitting it trips the other. That is the 400 the payments spec hits.
 *
 * The fix: the category is resolved by the engine, persisted on the line (InvoiceItem.vatCategory,
 * written at creation and refreshed at issuance), and READ here. When it is absent — a row older
 * than the column — the renderer refuses instead of inferring, because six categories share rate 0
 * and a guess produces a document that looks filed and is wrong.
 *
 * Every assertion below was inverted when that landed; the file kept its five cases so the fix is
 * shown to cover all of them and not only the one that was failing in e2e.
 */
import { InvoiceRenderingService } from './invoice-rendering.service';
import { resolve } from '@/compliance/engine/compliance-engine';

/** The engine's verdict for a French supplier, per destination and supply type. */
function engineCategory(buyerCountry: string, supplyType: 'GOODS' | 'SERVICES', buyerVat?: string) {
  const ctx = {
    supplier: {
      legalName: 'FR Co',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'FR12345678901', validated: true }],
    },
    buyer: {
      legalName: 'Buyer',
      countryCode: buyerCountry,
      role: 'B2B',
      identifiers: buyerVat ? [{ scheme: 'VAT', value: buyerVat, validated: true }] : [],
    },
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType }],
    issueDate: new Date('2027-01-15'),
    currency: 'EUR',
    externalRef: 'divergence',
  } as never;
  return resolve(ctx).tax.lines[0].treatment.components[0].category;
}

/**
 * The renderer's verdict, read out of the function it actually uses rather than re-implemented.
 * `vatCategoryFor` is a closure inside buildEInvoice, so the only honest way to observe it is to
 * render and read the emitted code back out of the XML.
 */
async function renderedCategory(
  buyerCountry: string,
  buyerVat: string | undefined,
  rate: number,
  category: string | null,
) {
  const svc = new InvoiceRenderingService();
  const built = svc.buildEInvoice(renderData(buyerCountry, buyerVat, rate, category));
  const xml = await built.exportXml('cii');
  // BT-151, read off the LINE (ram:IncludedSupplyChainTradeLineItem), not the document-level
  // BG-23 breakdown — they are separate rules and only the line one is BT-151.
  const line = xml.split('<ram:IncludedSupplyChainTradeLineItem>')[1] ?? '';
  return /<ram:CategoryCode>([A-Z]+)<\/ram:CategoryCode>/.exec(line)?.[1];
}

function renderData(
  buyerCountry: string,
  buyerVat: string | undefined,
  rate: number,
  category: string | null,
) {
  const country = { US: 'United States', DE: 'Germany', CH: 'Switzerland', FR: 'France' }[buyerCountry];
  return {
    rawNumber: 'INV-2027-0001',
    number: 1,
    issuedAt: new Date('2027-01-15'),
    createdAt: new Date('2027-01-15'),
    dueDate: new Date('2027-02-15'),
    currency: 'EUR',
    notes: '',
    totalHT: 100,
    totalVAT: (100 * rate) / 100,
    totalTTC: 100 + (100 * rate) / 100,
    company: {
      name: 'FR Co',
      country: 'France',
      address: '1 rue de Paris',
      city: 'Paris',
      postalCode: '75001',
      currency: 'EUR',
      email: 'fr@example.test',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'FR12345678901' },
        { scheme: 'LEGAL_ID', value: '12345678901234' },
      ],
    },
    client: {
      name: 'Buyer',
      country,
      address: '1 Main St',
      city: 'Town',
      postalCode: '10001',
      contactEmail: 'buyer@example.test',
      type: 'COMPANY',
      partyIdentifiers: buyerVat ? [{ scheme: 'VAT', value: buyerVat }] : [],
    },
    items: [
      {
        name: 'Consulting',
        description: 'Consulting',
        quantity: 1,
        unitPrice: 100,
        vatRate: rate,
        vatCategory: category,
        order: 0,
      },
    ],
  } as never;
}

describe('the renderer reads the VAT category from the plan, and agrees with the engine', () => {
  it('FR -> US services: engine says O, and the document now says O — the e2e 400 case', async () => {
    expect(engineCategory('US', 'SERVICES')).toBe('O');
    // Was Z. That document was unsatisfiable: BR-O-02 forbids the seller VAT identifier that
    // BR-Z-02 requires, so no identifier could make it valid.
    expect(await renderedCategory('US', undefined, 0, 'O')).toBe('O');
  }, 30_000);

  it('FR -> US goods: engine says G (export), and the document says G', async () => {
    expect(engineCategory('US', 'GOODS')).toBe('G');
    // Was Z. An export is not a domestic zero-rating, and BR-G-02 is stricter than BR-Z-02: it
    // does not accept the seller's tax registration id as a substitute for the VAT id.
    expect(await renderedCategory('US', undefined, 0, 'G')).toBe('G');
  }, 30_000);

  it('FR -> DE goods to a verified buyer: engine says K, and the document says K', async () => {
    expect(engineCategory('DE', 'GOODS', 'DE123456789')).toBe('K');
    // Was AE. The renderer had no notion of supply type, so a shipment of goods was reported as a
    // reverse-charged service: wrong exemption reason, and an EC Sales List under the wrong heading.
    expect(await renderedCategory('DE', 'DE123456789', 0, 'K')).toBe('K');
  }, 30_000);

  it('FR -> DE services to a verified buyer: both say AE', async () => {
    expect(engineCategory('DE', 'SERVICES', 'DE123456789')).toBe('AE');
    expect(await renderedCategory('DE', 'DE123456789', 0, 'AE')).toBe('AE');
  }, 30_000);

  it('FR -> FR at the standard rate: both say S', async () => {
    expect(engineCategory('FR', 'SERVICES')).toBe('S');
    expect(await renderedCategory('FR', undefined, 20, 'S')).toBe('S');
  }, 30_000);

  it('a line with NO resolved category is refused, not guessed', async () => {
    const svc = new InvoiceRenderingService();
    // The pre-column row. Under the old renderer this produced a confident Z.
    expect(() => svc.buildEInvoice(renderData('US', undefined, 0, null))).toThrow(/no resolved VAT category/);
  });
});
