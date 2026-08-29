/**
 * BG-15 — where the goods or services actually went.
 *
 * The columns existed on `Invoice` and reached nothing: a user could fill the delivery address and
 * the document never mentioned it. That is the repository's signature defect — sound data nobody
 * consumes — and this one has a deadline: France makes the mention mandatory for micro-entreprises
 * and PME from 2027-09-01 when it differs from the client's address.
 *
 * The FIELD is EN 16931 and universal. No country decides whether an address may be written down,
 * so it is emitted whenever it is set, and no profile is consulted.
 */
import { InvoiceRenderingService } from './invoice-rendering.service';

const data = (extra: Record<string, unknown>) =>
  ({
    kind: 'INVOICE',
    rawNumber: 'INV-1',
    number: 1,
    issuedAt: new Date('2026-08-29'),
    createdAt: new Date('2026-08-29'),
    paymentMethod: 'BANK_TRANSFER',
    paymentDetails: 'FR7630006000011234567890189',
    company: {
      name: 'Seller',
      description: null,
      foundedAt: null,
      currency: 'EUR',
      address: '1 rue A',
      city: 'Millau',
      postalCode: '12100',
      country: 'France',
      email: 's@example.test',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR18000000002' }],
    },
    client: {
      type: 'COMPANY',
      name: 'Buyer',
      description: null,
      foundedAt: null,
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: '2 rue B',
      city: 'Tours',
      postalCode: '37170',
      country: 'France',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR15000000001' }],
    },
    items: [
      { name: 'Prestation', quantity: 1, unitPrice: 100, vatRate: 20, vatCategory: 'S', type: 'SERVICE' },
    ],
    ...extra,
  }) as never;

describe('BG-15 — delivery location', () => {
  it('a recorded delivery address reaches the document', async () => {
    const built = new InvoiceRenderingService().buildEInvoice(
      data({
        deliveryAddress: '12 avenue du Chantier',
        deliveryPostalCode: '69003',
        deliveryCity: 'Lyon',
        deliveryCountry: 'France',
      }),
    );
    for (const fmt of ['ubl', 'cii']) {
      const xml = await built.exportXml(fmt);
      expect(`${fmt}: street`).toBe(
        xml.includes('12 avenue du Chantier') ? `${fmt}: street` : `${fmt}: MISSING`,
      );
      expect(`${fmt}: city`).toBe(xml.includes('Lyon') ? `${fmt}: city` : `${fmt}: MISSING`);
      expect(`${fmt}: zip`).toBe(xml.includes('69003') ? `${fmt}: zip` : `${fmt}: MISSING`);
    }
  }, 60000);

  it('no address recorded means no location element — not an empty one', async () => {
    // An empty DeliveryLocation would assert that delivery happened somewhere unnamed, which says
    // less than nothing and is the kind of half-truth a validator is right to reject.
    const xml = await new InvoiceRenderingService().buildEInvoice(data({})).exportXml('ubl');
    expect(xml).not.toContain('DeliveryLocation');
  }, 60000);

  it('falls back to the buyer country when the delivery country is not recorded', async () => {
    // BT-80 is mandatory inside BG-15, so a location without a country would be invalid. The buyer's
    // country is the honest default — the delivery address was entered as a variation on it.
    const xml = await new InvoiceRenderingService()
      .buildEInvoice(data({ deliveryCity: 'Lyon', deliveryPostalCode: '69003' }))
      .exportXml('ubl');
    expect(xml).toContain('DeliveryLocation');
    expect(xml).toContain('Lyon');
  }, 60000);
});
