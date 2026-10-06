import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { ciiFormatProvider } from './cii-provider';
import { clientToFormatParty } from './party-snapshot';
import { ublFormatProvider } from './ubl-provider';

const seller = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  email: 'contact@dupont-consulting.example',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'FR12345678901' },
    { scheme: 'LEGAL_ID', value: '12345678900017' },
  ],
};

const nameOnlyClient = {
  name: 'Name Only SARL',
  contacts: [],
  address: null,
  addressLine2: null,
  city: null,
  postalCode: null,
  country: 'France',
  partyIdentifiers: [],
};

const document = {
  id: 'doc-1',
  displayNumber: 'INV-2026-0001',
  status: 'validated',
  data: {
    client: 'client-1',
    issueDate: '2026-09-25',
    dueDate: '2026-10-25',
    currency: 'EUR',
    lines: [{ description: 'Consulting', quantity: 1, unit: 'unit', unitPrice: 1000, vatRate: '20' }],
  },
};

describe('a client with no address, city or postal code', () => {
  it('keeps the nulls in the format party snapshot', () => {
    expect(clientToFormatParty(nameOnlyClient)).toMatchObject({
      name: 'Name Only SARL',
      address: null,
      city: null,
      postalCode: null,
    });
  });

  it.each([
    ['UBL', ublFormatProvider],
    ['CII', ciiFormatProvider],
  ] as const)(
    '%s: builds without crashing and never writes a literal null',
    async (_label, provider) => {
      const result = await provider.build(
        buildInvoiceDescriptor(),
        document,
        seller,
        clientToFormatParty(nameOnlyClient),
      );

      const xml = Buffer.from(result.bytes).toString('utf-8');
      expect(xml).toContain('Name Only SARL');
      expect(xml).not.toMatch(/>null</);
    },
    30_000,
  );
});
