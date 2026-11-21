import { vi, type Mock, type MockedFunction } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { resolveDocumentCustomFieldDescriptors } from '../company-custom-fields/persistence';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
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

interface Seller {
  country: string;
  language: string;
  identifiers?: { scheme: string; value: string }[];
  companyLaw?: unknown;
}

interface RenderOptions {
  status?: string;
  purpose?: RenderPurpose;
  clientLanguage?: string;
  descriptor?: DocumentTypeDescriptor;
}

/** The seller block of the rendered page, as plain text. */
async function renderSeller(seller: Seller, options: RenderOptions = {}): Promise<string> {
  (prisma.company.findUnique as Mock).mockResolvedValue({
    name: 'Seller Ltd',
    address: '1 Main Street',
    addressLine2: null,
    city: 'Capital',
    postalCode: '1000',
    country: seller.country,
    countryCode: null,
    iban: null,
    language: seller.language,
    exemptVat: false,
    brandingAccentColor: null,
    brandingFont: null,
    brandingLogoId: null,
    partyIdentifiers: seller.identifiers ?? [],
    companyLaw: seller.companyLaw ?? null,
  });
  (prisma.client.findFirst as Mock).mockResolvedValue({
    language: options.clientLanguage ?? null,
    address: '2 Market Square',
    addressLine2: null,
    postalCode: '2000',
    city: 'Harbour',
    country: seller.country,
    countryCode: null,
    type: 'COMPANY',
    partyIdentifiers: [],
  });
  const referenceRegistry = new EntityReferenceRegistry();
  const clientsService = { getClientById: vi.fn().mockResolvedValue({ id: 'client-1', name: 'Buyer Corp' }) };
  referenceRegistry.register('client', buildClientReferenceProvider(clientsService as never));

  await renderDocumentInstance(
    { referenceRegistry },
    'company-1',
    options.descriptor ?? buildInvoiceDescriptor(),
    {
      id: 'document-1',
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
  return html
    .slice(html.indexOf('class="company-info"'), html.indexOf('class="recipient-info"'))
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll('&#039;', "'")
    .replaceAll(/\s+/g, ' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRenderPdf.mockResolvedValue(Buffer.from('pdf-bytes'));
  (resolveDocumentCustomFieldDescriptors as Mock).mockResolvedValue([]);
  (resolveEnabledPaymentMethodPresentations as Mock).mockResolvedValue([]);
});

const FRENCH_SAS = {
  country: 'France',
  language: 'fr',
  identifiers: [{ scheme: 'LEGAL_ID', value: '732829320' }],
  companyLaw: {
    legalForm: 'FR_SAS',
    values: { shareCapital: { amount: '1000', currency: 'EUR' }, registerCity: 'Lyon' },
  },
};

describe("the PDF prints the seller's company-law mentions its country requires", () => {
  it('France: legal form, share capital and RCS city of an SAS', async () => {
    const seller = await renderSeller(FRENCH_SAS);

    expect(seller).toContain('SAS au capital de 1000.00 EUR');
    expect(seller).toContain('RCS Lyon');
  });

  it('Germany: legal form, register court and number, and managing directors of a GmbH', async () => {
    const seller = await renderSeller({
      country: 'Germany',
      language: 'de',
      identifiers: [{ scheme: 'LEGAL_ID', value: 'HRB 12345' }],
      companyLaw: {
        legalForm: 'DE_GMBH',
        values: { registerCourt: 'Amtsgericht München', managingDirectors: 'Erika Mustermann' },
      },
    });

    expect(seller).toContain('GmbH, Registergericht: Amtsgericht München, HRB 12345');
    expect(seller).toContain('Geschäftsführer: Erika Mustermann');
  });

  it('Italy: register office and number, paid-up capital and single member of an S.r.l.', async () => {
    const seller = await renderSeller({
      country: 'Italy',
      language: 'it',
      companyLaw: {
        legalForm: 'IT_SRL_SOCIO_UNICO',
        values: {
          registerOffice: 'Milano',
          registerNumber: '01234567890',
          shareCapital: { amount: '10000', currency: 'EUR' },
        },
      },
    });

    expect(seller).toContain('Registro delle imprese di Milano n. 01234567890');
    expect(seller).toContain('Capitale sociale versato 10000.00 EUR');
    expect(seller).toContain('Società con unico socio');
  });

  it('Poland: register court, KRS number and share capital of a sp. z o.o.', async () => {
    const seller = await renderSeller({
      country: 'Poland',
      language: 'pl',
      companyLaw: {
        legalForm: 'PL_SP_ZOO',
        values: {
          registerCourt: 'Sąd Rejonowy dla m.st. Warszawy, XII Wydział Gospodarczy KRS',
          krsNumber: '0000123456',
          shareCapital: { amount: '5000', currency: 'PLN' },
        },
      },
    });

    expect(seller).toContain(
      'Sąd rejestrowy: Sąd Rejonowy dla m.st. Warszawy, XII Wydział Gospodarczy KRS, KRS 0000123456',
    );
    expect(seller).toContain('Kapitał zakładowy 5000.00 PLN');
  });

  it('Portugal: type, registry office, registration number and share capital of a sociedade por quotas', async () => {
    const seller = await renderSeller({
      country: 'Portugal',
      language: 'pt',
      identifiers: [{ scheme: 'LEGAL_ID', value: '500000000' }],
      companyLaw: {
        legalForm: 'PT_LDA',
        values: {
          registryOffice: 'Conservatória do Registo Comercial de Lisboa',
          shareCapital: { amount: '5000', currency: 'EUR' },
        },
      },
    });

    expect(seller).toContain(
      'Sociedade por quotas, matriculada na Conservatória do Registo Comercial de Lisboa sob o número de ' +
        'matrícula e de identificação de pessoa coletiva 500000000',
    );
    expect(seller).toContain('Capital social 5000.00 EUR');
  });

  it('Algeria: legal form, activity and share capital of an SARL', async () => {
    const seller = await renderSeller({
      country: 'Algeria',
      language: 'fr',
      companyLaw: {
        legalForm: 'DZ_SARL',
        values: { activity: 'Commerce de gros', shareCapital: { amount: '100000', currency: 'DZD' } },
      },
    });

    expect(seller).toContain('Forme juridique : SARL, activité : Commerce de gros');
    expect(seller).toContain('Capital social : 100000.00 DZD');
  });

  it("prints them in the document's language", async () => {
    const seller = await renderSeller(FRENCH_SAS, { clientLanguage: 'en' });

    expect(seller).toContain('SAS with a share capital of 1000.00 EUR');
  });

  it('prints them on the other document types the country names', async () => {
    const seller = await renderSeller(FRENCH_SAS, { descriptor: buildQuoteDescriptor() });

    expect(seller).toContain('SAS au capital de 1000.00 EUR');
  });

  it('prints nothing for a seller whose country declares no company-law mention', async () => {
    const seller = await renderSeller({ country: 'Spain', language: 'en', companyLaw: { legalForm: 'SL' } });

    expect(seller).not.toContain('missing');
    expect(seller).not.toContain('capital');
  });
});

describe('a form with no share capital', () => {
  it('a French individual entrepreneur prints its designation and no capital line, even on the working copy', async () => {
    const seller = await renderSeller({
      country: 'France',
      language: 'fr',
      identifiers: [
        { scheme: 'LEGAL_ID', value: '732829320' },
        { scheme: 'VAT', value: 'FR44732829320' },
      ],
      companyLaw: { legalForm: 'FR_EI' },
    });

    expect(seller).toContain('EI');
    expect(seller).not.toContain('capital');
    expect(seller).not.toContain('manquant');
  });
});

describe('a required value that is not filled in', () => {
  const withoutCapital = {
    ...FRENCH_SAS,
    companyLaw: { legalForm: 'FR_SAS', values: { registerCity: 'Lyon' } },
  };

  it('is flagged on the working copy', async () => {
    const seller = await renderSeller(withoutCapital);

    expect(seller).toContain('SAS au capital de Capital social: manquant');
  });

  it('is left out of the copy a client keeps', async () => {
    const seller = await renderSeller(withoutCapital, { status: 'sending', purpose: 'delivery' });

    expect(seller).not.toContain('capital');
    expect(seller).toContain('RCS Lyon');
  });

  it('a seller that has not chosen its legal form is asked for it', async () => {
    const seller = await renderSeller({ ...FRENCH_SAS, companyLaw: null });

    expect(seller).toContain('Forme juridique: manquant');
  });

  it('a legal form chosen under another country is asked for again', async () => {
    const seller = await renderSeller({
      country: 'Italy',
      language: 'it',
      companyLaw: FRENCH_SAS.companyLaw,
    });

    expect(seller).toContain('Forma giuridica: mancante');
  });
});
