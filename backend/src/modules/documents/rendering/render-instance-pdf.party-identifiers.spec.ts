import { vi, type Mock, type MockedFunction } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { resolveDocumentCustomFieldDescriptors } from '../company-custom-fields/persistence';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { resolveEnabledPaymentMethodPresentations } from '../payment-methods/persistence';
import { buildClientReferenceProvider } from '../references/client-reference.provider';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { renderDocumentInstance } from './render-instance-pdf';
import { renderPdf } from './render-pdf';
import { RenderPurpose } from './status-line-policy';

vi.mock('./render-pdf');
vi.mock('../payment-methods/persistence');
vi.mock('../company-custom-fields/persistence');
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUnique: vi.fn() }, client: { findFirst: vi.fn() } },
}));

const mockedRenderPdf = renderPdf as MockedFunction<typeof renderPdf>;

interface Identifier {
  scheme: string;
  value: string;
}

interface Seller {
  country: string;
  exemptVat?: boolean;
  identifiers?: Identifier[];
}

interface Buyer {
  country: string;
  type?: 'COMPANY' | 'INDIVIDUAL';
  vatRegistered?: boolean;
  identifiers?: Identifier[];
}

const SELLER_NAME = 'Seller Ltd';
const BUYER_NAME = 'Buyer Corp';

async function renderInvoice(
  seller: Seller,
  buyer: Buyer,
  options: { status?: string; purpose?: RenderPurpose } = {},
): Promise<{ seller: string; buyer: string }> {
  (prisma.company.findUnique as Mock).mockResolvedValue({
    name: SELLER_NAME,
    address: '1 Main Street',
    addressLine2: null,
    city: 'Capital',
    postalCode: '1000',
    country: seller.country,
    countryCode: null,
    iban: null,
    language: null,
    exemptVat: seller.exemptVat ?? false,
    brandingAccentColor: null,
    brandingFont: null,
    brandingLogoId: null,
    partyIdentifiers: seller.identifiers ?? [],
  });
  (prisma.client.findFirst as Mock).mockResolvedValue({
    language: null,
    address: '2 Market Square',
    addressLine2: null,
    postalCode: '2000',
    city: 'Harbour',
    country: buyer.country,
    countryCode: null,
    type: buyer.type ?? 'COMPANY',
    vatRegistered: buyer.vatRegistered ?? true,
    partyIdentifiers: buyer.identifiers ?? [],
  });
  const referenceRegistry = new EntityReferenceRegistry();
  const clientsService = { getClientById: vi.fn().mockResolvedValue({ id: 'client-1', name: BUYER_NAME }) };
  referenceRegistry.register('client', buildClientReferenceProvider(clientsService as never));

  await renderDocumentInstance(
    { referenceRegistry },
    'company-1',
    buildInvoiceDescriptor(),
    {
      id: 'invoice-1',
      status: options.status ?? 'draft',
      data: { client: 'client-1', currency: 'EUR', issueDate: '2026-10-01', lines: [] },
      createdAt: new Date('2026-10-01T00:00:00Z'),
      displayNumber: null,
      atcud: null,
      acceptedOption: null,
    },
    options.purpose ?? 'on-demand',
  );

  const html = mockedRenderPdf.mock.calls[0][0];
  const textBetween = (start: string, end: string) =>
    html
      .slice(html.indexOf(start), html.indexOf(end))
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll('&#039;', "'")
      .replaceAll(/\s+/g, ' ');
  return {
    seller: textBetween('class="company-address"', 'class="recipient-info"'),
    buyer: textBetween('class="recipient-info"', 'class="meta-grid"'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRenderPdf.mockResolvedValue(Buffer.from('pdf-bytes'));
  (resolveDocumentCustomFieldDescriptors as Mock).mockResolvedValue([]);
  (resolveEnabledPaymentMethodPresentations as Mock).mockResolvedValue([]);
});

describe('the invoice PDF prints the parties identifiers', () => {
  it("prints the seller's identifiers under its address, labelled as its own country names them", async () => {
    const { seller } = await renderInvoice(
      {
        country: 'France',
        identifiers: [
          { scheme: 'LEGAL_ID', value: '732829320' },
          { scheme: 'VAT', value: 'FR44732829320' },
        ],
      },
      { country: 'France', identifiers: [{ scheme: 'LEGAL_ID', value: '552100554' }] },
    );

    expect(seller).toContain('SIREN / SIRET: 732829320');
    expect(seller).toContain('N° TVA intracommunautaire: FR44732829320');
  });

  it("prints the buyer's identifiers in the buyer block, labelled as the buyer's own country names them", async () => {
    const { seller, buyer } = await renderInvoice(
      { country: 'France', identifiers: [{ scheme: 'LEGAL_ID', value: '732829320' }] },
      { country: 'Germany', identifiers: [{ scheme: 'VAT', value: 'DE123456789' }] },
    );

    expect(buyer).toContain('Umsatzsteuer-Identifikationsnummer (USt-IdNr.): DE123456789');
    expect(seller).not.toContain('DE123456789');
    expect(buyer).not.toContain('732829320');
  });

  it('flags the VAT number of a VAT-registered French seller as missing on the working copy', async () => {
    const { seller } = await renderInvoice(
      { country: 'France', identifiers: [{ scheme: 'LEGAL_ID', value: '732829320' }] },
      { country: 'France', identifiers: [{ scheme: 'LEGAL_ID', value: '552100554' }] },
    );

    expect(seller).toContain('N° TVA intracommunautaire: missing');
  });

  describe('the VAT numbers French law asks for depend on the seller and the buyer', () => {
    const frenchSeller = { country: 'France', identifiers: [{ scheme: 'LEGAL_ID', value: '732829320' }] };

    it('a seller under the franchise en base is not asked for a VAT number', async () => {
      const { seller } = await renderInvoice(
        { ...frenchSeller, exemptVat: true },
        { country: 'France', identifiers: [{ scheme: 'LEGAL_ID', value: '552100554' }] },
      );

      expect(seller).not.toContain('N° TVA intracommunautaire');
    });

    it('an intra-EU business buyer is asked for its VAT number, and so is the seller, franchise or not', async () => {
      const { seller, buyer } = await renderInvoice(
        { ...frenchSeller, exemptVat: true },
        { country: 'Germany', type: 'COMPANY' },
      );

      expect(buyer).toContain('Umsatzsteuer-Identifikationsnummer (USt-IdNr.): missing');
      expect(seller).toContain('N° TVA intracommunautaire: missing');
      expect(buyer).not.toContain('SIREN');
    });

    it('an intra-EU business buyer that is not VAT-registered is asked for no VAT number, nor is the seller', async () => {
      const { seller, buyer } = await renderInvoice(
        { ...frenchSeller, exemptVat: true },
        { country: 'Germany', type: 'COMPANY', vatRegistered: false },
      );

      expect(buyer).not.toContain('Umsatzsteuer');
      expect(seller).not.toContain('N° TVA intracommunautaire');
    });

    it('a domestic business buyer is asked for its SIREN, not its VAT number, whether registered or not', async () => {
      for (const vatRegistered of [true, false]) {
        const { buyer } = await renderInvoice(frenchSeller, {
          country: 'France',
          type: 'COMPANY',
          vatRegistered,
        });

        expect(buyer).toContain('SIREN / SIRET: missing');
        expect(buyer).not.toContain('TVA');
      }
    });

    it('a private buyer is asked for neither', async () => {
      const { buyer } = await renderInvoice(frenchSeller, { country: 'France', type: 'INDIVIDUAL' });

      expect(buyer).not.toContain('missing');
    });
  });

  it('the copy a client keeps never prints a missing marker, only what is filled in', async () => {
    const { seller, buyer } = await renderInvoice(
      frenchSellerWithoutVat(),
      { country: 'Germany', type: 'COMPANY' },
      { status: 'sending', purpose: 'delivery' },
    );

    expect(seller).toContain('SIREN / SIRET: 732829320');
    expect(seller).not.toContain('missing');
    expect(buyer).not.toContain('missing');
  });
});

interface CountryCase {
  name: string;
  seller: string;
  buyer: string;
  sellerRequires: [scheme: string, label: string][];
  buyerRequires: [scheme: string, label: string][];
}

const PT_NIF = 'NIF / NIPC (Número de Identificação Fiscal / Número de Identificação de Pessoa Coletiva)';

// What each country's invoice law asks of a business client, read from the statutes, never from the data files.
const COUNTRY_CASES: CountryCase[] = [
  {
    name: 'France, domestic',
    seller: 'France',
    buyer: 'France',
    sellerRequires: [
      ['LEGAL_ID', 'SIREN / SIRET'],
      ['VAT', 'N° TVA intracommunautaire'],
    ],
    buyerRequires: [['LEGAL_ID', 'SIREN / SIRET']],
  },
  {
    name: 'Germany, to a business in another member state',
    seller: 'Germany',
    buyer: 'France',
    sellerRequires: [['VAT', 'Umsatzsteuer-Identifikationsnummer (USt-IdNr.)']],
    buyerRequires: [['VAT', 'N° TVA intracommunautaire']],
  },
  {
    name: 'Italy, domestic',
    seller: 'Italy',
    buyer: 'Italy',
    sellerRequires: [['VAT', 'Partita IVA']],
    buyerRequires: [['VAT', 'Partita IVA']],
  },
  {
    name: 'Poland, domestic',
    seller: 'Poland',
    buyer: 'Poland',
    sellerRequires: [['LEGAL_ID', 'NIP']],
    buyerRequires: [['LEGAL_ID', 'NIP']],
  },
  {
    name: 'Portugal, domestic',
    seller: 'Portugal',
    buyer: 'Portugal',
    sellerRequires: [['LEGAL_ID', PT_NIF]],
    buyerRequires: [['LEGAL_ID', PT_NIF]],
  },
  {
    name: 'Algeria, domestic',
    seller: 'Algeria',
    buyer: 'Algeria',
    sellerRequires: [
      ['RC', 'RC (Registre du Commerce)'],
      ['NIS', "NIS (Numero d'Identification Statistique)"],
      ['NIF', "NIF (Numero d'Identification Fiscale)"],
      ['AI', "AI (Article d'Imposition)"],
    ],
    buyerRequires: [
      ['RC', 'RC (Registre du Commerce)'],
      ['NIS', "NIS (Numero d'Identification Statistique)"],
    ],
  },
];

const missingCount = (text: string) => text.split(': missing').length - 1;
const filledWith = (requires: CountryCase['sellerRequires']) =>
  requires.map(([scheme], index) => ({ scheme, value: `VALUE-${scheme}-${index}` }));

describe.each(COUNTRY_CASES)('the identifiers $name invoice law requires', (country) => {
  it('are each flagged on the working copy when not filled in, and nothing else is', async () => {
    const { seller, buyer } = await renderInvoice({ country: country.seller }, { country: country.buyer });

    for (const [, label] of country.sellerRequires) expect(seller).toContain(`${label}: missing`);
    for (const [, label] of country.buyerRequires) expect(buyer).toContain(`${label}: missing`);
    expect(missingCount(seller)).toBe(country.sellerRequires.length);
    expect(missingCount(buyer)).toBe(country.buyerRequires.length);
  });

  it('print with their values once filled in', async () => {
    const sellerValues = filledWith(country.sellerRequires);
    const buyerValues = filledWith(country.buyerRequires);
    const { seller, buyer } = await renderInvoice(
      { country: country.seller, identifiers: sellerValues },
      { country: country.buyer, identifiers: buyerValues },
    );

    for (const [index, [, label]] of country.sellerRequires.entries()) {
      expect(seller).toContain(`${label}: ${sellerValues[index].value}`);
    }
    for (const [index, [, label]] of country.buyerRequires.entries()) {
      expect(buyer).toContain(`${label}: ${buyerValues[index].value}`);
    }
    expect(missingCount(seller) + missingCount(buyer)).toBe(0);
  });
});

function frenchSellerWithoutVat(): Seller {
  return { country: 'France', identifiers: [{ scheme: 'LEGAL_ID', value: '732829320' }] };
}
