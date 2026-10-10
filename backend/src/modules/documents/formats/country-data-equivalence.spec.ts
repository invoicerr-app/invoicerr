/**
 * Pins the exact bytes every format builds for a seller and a buyer of each country this product
 * ships data for, plus one country it has no file for and one it cannot resolve at all. Moving a
 * country fact out of code and into `countries/data/` must leave every hash below unchanged.
 * Validation is stubbed: it judges the bytes without changing them, and the other format specs run it.
 */
import { createHash } from 'node:crypto';

import { defaultComposedCountryCatalog } from '../countries/registry';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { ciiFormatProvider } from './cii-provider';
import { DocumentFormatParty, DocumentFormatProvider } from './format-provider';
import { fa3FormatProvider } from './national/fa3-provider';
import { fatturapaFormatProvider } from './national/fatturapa-provider';
import { peppolBisFormatProvider } from './peppol-bis-provider';
import { buildEuInvoiceForDocument } from './shared-build';
import { ublFormatProvider } from './ubl-provider';
import { xrechnungFormatProvider } from './xrechnung-provider';

vi.mock('./vendored/validate-schematron', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./vendored/validate-schematron')>()),
  validateSchematron: () => ({ valid: true, errors: [] }),
}));
vi.mock('./vendored/validate-xsd', () => ({ validateXsd: async () => ({ valid: true, errors: [] }) }));

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

const DOCUMENT_DATA = {
  client: 'client-1',
  issueDate: '2026-08-30',
  dueDate: '2026-09-30',
  currency: 'EUR',
  buyerReference: '04011000-12345-67',
  lines: [
    { description: 'Consulting', quantity: 10, unit: 'hour', unitPrice: 1200, vatRate: '20' },
    { description: 'Training', quantity: 2, unit: 'day', unitPrice: 800, vatRate: '0' },
  ],
};

const DOCUMENT = { id: 'doc-1', data: DOCUMENT_DATA, displayNumber: 'INV-2026-0001', status: 'sent' };

/** Every shipped country, plus one with no data file and two the builders cannot resolve. */
const COUNTRIES = [...defaultComposedCountryCatalog.countries(), 'NL', 'Atlantis', ''];

const PROVIDERS: DocumentFormatProvider[] = [
  ublFormatProvider,
  ciiFormatProvider,
  peppolBisFormatProvider,
  xrechnungFormatProvider,
  fatturapaFormatProvider,
  fa3FormatProvider,
];

function party(role: string, country: string): DocumentFormatParty {
  const prefix = /^[A-Z]{2}$/.test(country) ? country : 'XX';
  return {
    name: `${role} ${country || 'none'}`,
    address: '1 Main Street',
    city: 'Capital',
    postalCode: '10000',
    country,
    email: `${role.toLowerCase()}@example.test`,
    phone: '+10000000000',
    iban: 'DE89370400440532013000',
    partyIdentifiers: [
      { scheme: 'VAT', value: `${prefix}123456789` },
      { scheme: 'LEGAL_ID', value: '12345678900017' },
    ],
  };
}

function digest(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

async function outcome(run: () => Promise<Uint8Array | string>): Promise<string> {
  try {
    return digest(await run());
  } catch (error) {
    return `throws ${digest((error as Error).message)}`;
  }
}

function semanticJson(seller: DocumentFormatParty, buyer: DocumentFormatParty, override?: 'full'): string {
  return JSON.stringify(
    buildEuInvoiceForDocument(descriptor, DOCUMENT, seller, buyer, { legalIdOverride: override }),
  );
}

async function outcomesFor(sellerCountry: string): Promise<Record<string, string>> {
  const seller = party('Seller', sellerCountry);
  const result: Record<string, string> = {};
  for (const buyerCountry of COUNTRIES) {
    const buyer = party('Buyer', buyerCountry);
    for (const provider of PROVIDERS) {
      result[`${buyerCountry || 'none'} ${provider.id}`] = await outcome(async () => {
        const built = await provider.build(descriptor, DOCUMENT, seller, buyer);
        return built.bytes;
      });
    }
    for (const override of [undefined, 'full'] as const) {
      result[`${buyerCountry || 'none'} semantic ${override ?? 'default'}`] = await outcome(async () =>
        semanticJson(seller, buyer, override),
      );
    }
  }
  return result;
}

describe('format output per seller and buyer country', () => {
  it.each(COUNTRIES.map((country) => [country || 'none', country]))(
    'seller %s: every format is byte-identical to the pinned output',
    async (_label, sellerCountry) => {
      expect(await outcomesFor(sellerCountry)).toMatchSnapshot();
    },
    60_000,
  );
});
