/**
 * The renderer decides the VAT category from the RATE. The engine decides it from the operation.
 * They disagree on three of five cases, and the e2e suite has been failing on one of them.
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
 * THIS SPEC ENCODES THE DEFECT, NOT THE INTENDED BEHAVIOUR. Every `toBe` below marked DIVERGES is
 * what the renderer does today, and every one of them is wrong. When the renderer is changed to
 * consume the plan's category instead of re-deriving it, these assertions must be inverted rather
 * than deleted — that is the signal the fix landed and covered every case, not just the one that
 * was failing.
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
async function renderedCategory(buyerCountry: string, buyerVat: string | undefined, rate: number) {
  const svc = new InvoiceRenderingService();
  const built = svc.buildEInvoice(renderData(buyerCountry, buyerVat, rate));
  const xml = await built.exportXml('cii');
  // BT-151, read off the LINE (ram:IncludedSupplyChainTradeLineItem), not the document-level
  // BG-23 breakdown — they are separate rules and only the line one is BT-151.
  const line = xml.split('<ram:IncludedSupplyChainTradeLineItem>')[1] ?? '';
  return /<ram:CategoryCode>([A-Z]+)<\/ram:CategoryCode>/.exec(line)?.[1];
}

function renderData(buyerCountry: string, buyerVat: string | undefined, rate: number) {
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
        order: 0,
      },
    ],
  } as never;
}

describe('the renderer re-derives the VAT category from the rate, and contradicts the engine', () => {
  it('FR -> US services: engine says O (out of scope), the document says Z — the e2e 400', async () => {
    expect(engineCategory('US', 'SERVICES')).toBe('O');
    // DIVERGES. BR-O-02 forbids the seller VAT id on this document; BR-Z-02 requires it.
    expect(await renderedCategory('US', undefined, 0)).toBe('Z');
  }, 30_000);

  it('FR -> US goods: engine says G (export), the document says Z', async () => {
    expect(engineCategory('US', 'GOODS')).toBe('G');
    // DIVERGES. An export is not a domestic zero-rating, and BR-G-02 is stricter than BR-Z-02:
    // it does not accept the seller's tax registration id as a substitute for the VAT id.
    expect(await renderedCategory('US', undefined, 0)).toBe('Z');
  }, 30_000);

  it('FR -> DE goods to a verified buyer: engine says K (intra-EU), the document says AE', async () => {
    expect(engineCategory('DE', 'GOODS', 'DE123456789')).toBe('K');
    // DIVERGES. The renderer has no notion of supply type, so a shipment of goods is reported as
    // a reverse-charged service: wrong exemption reason, and an EC Sales List filed under the
    // wrong heading.
    expect(await renderedCategory('DE', 'DE123456789', 0)).toBe('AE');
  }, 30_000);

  it('FR -> DE services to a verified buyer: both say AE', async () => {
    expect(engineCategory('DE', 'SERVICES', 'DE123456789')).toBe('AE');
    expect(await renderedCategory('DE', 'DE123456789', 0)).toBe('AE');
  }, 30_000);

  it('FR -> FR at the standard rate: both say S', async () => {
    expect(engineCategory('FR', 'SERVICES')).toBe('S');
    expect(await renderedCategory('FR', undefined, 20)).toBe('S');
  }, 30_000);
});
