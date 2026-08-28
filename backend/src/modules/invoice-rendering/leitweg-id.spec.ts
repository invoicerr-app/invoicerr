/**
 * DE Leitweg-ID → BT-10 BuyerReference (M-9 part 2).
 *
 * The DE compliance profile declares LEITWEG_ID as a required-identifier for B2G routing
 * (src/compliance/profiles/data/de.ts) but it was never injected into the rendered invoice —
 * cbc:BuyerReference always fell back to the invoice number, leaving B2G DE non-conforming
 * (Leitweg-ID is the mandatory routing key for German federal/state B2G invoices).
 *
 * buildEInvoice now reads the BUYER's LEITWEG_ID party identifier and, when present, emits it
 * verbatim as cbc:BuyerReference; otherwise the existing invoice-number fallback is preserved
 * (still satisfies PEPPOL-EN16931-R003 — some buyer reference must be present).
 */
import { InvoiceRenderingService, InvoiceRenderData } from './invoice-rendering.service';

const NOW = new Date('2025-06-01T10:00:00Z');

function baseData(overrides: Partial<InvoiceRenderData> = {}): InvoiceRenderData {
  return {
    rawNumber: 'RE-2025-0042',
    number: null,
    issuedAt: NOW,
    createdAt: NOW,
    company: {
      name: 'Schmidt Software GmbH',
      description: null,
      foundedAt: null,
      currency: 'EUR',
      address: 'Friedrichstr. 100',
      city: 'Berlin',
      postalCode: '10117',
      country: 'Germany',
      partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
    },
    client: {
      type: 'COMPANY',
      name: 'Bundesministerium für Test',
      description: null,
      foundedAt: null,
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Wilhelmstr. 1',
      city: 'Berlin',
      postalCode: '10117',
      country: 'Germany',
      partyIdentifiers: [{ scheme: 'VAT', value: 'DE987654321' }],
    },
    items: [
      { name: 'Consulting', quantity: 1, unitPrice: 1000, vatRate: 19, vatCategory: 'S', type: 'SERVICE' },
    ],
    ...overrides,
  };
}

describe('buildEInvoice BT-10 BuyerReference — DE Leitweg-ID (M-9)', () => {
  const service = new InvoiceRenderingService();

  it('emits the buyer Leitweg-ID as cbc:BuyerReference when present', async () => {
    const data = baseData({
      client: {
        ...baseData().client,
        partyIdentifiers: [
          { scheme: 'VAT', value: 'DE987654321' },
          { scheme: 'LEITWEG_ID', value: '04011000-1234512345-06' },
        ],
      },
    });
    const inv = service.buildEInvoice(data);
    const xml = await inv.exportXml('xrechnung');
    expect(xml).toContain('<cbc:BuyerReference>04011000-1234512345-06</cbc:BuyerReference>');
  });

  it('falls back to the invoice number when the buyer has no Leitweg-ID (existing behavior preserved)', async () => {
    const inv = service.buildEInvoice(baseData());
    const xml = await inv.exportXml('xrechnung');
    expect(xml).toContain('<cbc:BuyerReference>RE-2025-0042</cbc:BuyerReference>');
  });

  it('Leitweg-ID takes priority over the invoice-number fallback even when both are present', async () => {
    const data = baseData({
      client: {
        ...baseData().client,
        partyIdentifiers: [{ scheme: 'LEITWEG_ID', value: '991-12345-67' }],
      },
    });
    const inv = service.buildEInvoice(data);
    const xml = await inv.exportXml('ubl');
    expect(xml).toContain('<cbc:BuyerReference>991-12345-67</cbc:BuyerReference>');
    expect(xml).not.toContain('<cbc:BuyerReference>RE-2025-0042</cbc:BuyerReference>');
  });

  it('non-DE buyers without a Leitweg-ID are unaffected (plain fallback)', async () => {
    const data = baseData({
      client: {
        ...baseData().client,
        country: 'France',
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
      },
    });
    const inv = service.buildEInvoice(data);
    const xml = await inv.exportXml('ubl');
    expect(xml).toContain('<cbc:BuyerReference>RE-2025-0042</cbc:BuyerReference>');
  });
});
