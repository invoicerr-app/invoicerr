import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import {
  draftInvoiceContext,
  invoiceActionRegistry,
  issuanceDocument,
  stubIssuanceCollaborators,
} from '../__tests__/invoice-action-harness';
import { createTestCompany } from '../__tests__/issuable-client';
import { resolveRequiredIdentifiers } from '../country-identifiers/country-identifiers';
import { defaultCountryIdentifierRequirementsCatalog } from '../country-identifiers/registry';
import { PartyType } from '../country-identifiers/schema';
import { seedCountryIdentifierRequirements } from '../country-identifiers/seed';
import * as takeNumber from '../numbering/take-number';
import * as persistence from '../persistence';
import { CLIENT_INCOMPLETE_CODE } from './client-issuance-readiness';
import { INVOICE_IDENTIFIERS_MISSING_CODE } from './invoice-identifier-readiness';

vi.mock('../tax/load-and-resolve');
vi.mock('../numbering/take-number');
vi.mock('../b2g-routing/b2g-routing');
vi.mock('../transports/channel-policy/mandate');
vi.mock('../country-policy/country-policy');
vi.mock('../transports/company-transport');
vi.mock('../persistence');

type Asked = Record<PartyType, string[]>;

/** What each country's law asks of a domestic client with no identifier on file, by client type. */
const EXPECTED: Record<string, { form: Asked; issuance: Asked }> = {
  DE: { form: { COMPANY: [], INDIVIDUAL: [] }, issuance: { COMPANY: [], INDIVIDUAL: [] } },
  DZ: {
    form: { COMPANY: ['RC', 'NIS', 'NIF', 'AI'], INDIVIDUAL: [] },
    issuance: { COMPANY: ['RC', 'NIS'], INDIVIDUAL: [] },
  },
  FR: {
    form: { COMPANY: ['LEGAL_ID'], INDIVIDUAL: [] },
    issuance: { COMPANY: ['LEGAL_ID'], INDIVIDUAL: [] },
  },
  // The codice fiscale is a personal tax code, owed on the invoice of an Italian private buyer.
  IT: {
    form: { COMPANY: ['VAT'], INDIVIDUAL: ['LEGAL_ID'] },
    issuance: { COMPANY: ['VAT'], INDIVIDUAL: ['LEGAL_ID'] },
  },
  PL: {
    form: { COMPANY: ['LEGAL_ID'], INDIVIDUAL: [] },
    issuance: { COMPANY: ['LEGAL_ID'], INDIVIDUAL: [] },
  },
  PT: {
    form: { COMPANY: ['LEGAL_ID'], INDIVIDUAL: [] },
    issuance: { COMPANY: ['LEGAL_ID'], INDIVIDUAL: [] },
  },
};

const COUNTRY_NAMES: Record<string, string> = {
  DE: 'Germany',
  DZ: 'Algeria',
  FR: 'France',
  IT: 'Italy',
  PL: 'Poland',
  PT: 'Portugal',
};

const COUNTRIES = Object.keys(EXPECTED);
const CASES = COUNTRIES.flatMap((countryCode) =>
  (['INDIVIDUAL', 'COMPANY'] as const).map((type) => ({ countryCode, type })),
);
const createdCompanyIds: string[] = [];

async function domesticSellerAndClient(countryCode: string, type: PartyType) {
  const company = await createTestCompany(`Seller ${countryCode} for ${type}`);
  createdCompanyIds.push(company.id);
  await prisma.company.update({
    where: { id: company.id },
    data: { countryCode, country: COUNTRY_NAMES[countryCode] },
  });
  const client = await prisma.client.create({
    data: {
      companyId: company.id,
      name: `Client ${countryCode} ${type}`,
      type,
      address: '1 Client Street',
      postalCode: '00001',
      city: 'Capital',
      countryCode,
      country: COUNTRY_NAMES[countryCode],
    },
  });
  return { companyId: company.id, clientId: client.id };
}

/** The client identifiers an issuance refusal names, from whichever gate refused. */
async function clientIdentifiersAskedAtIssuance(companyId: string, clientId: string): Promise<string[]> {
  (persistence.findOwnedDocument as Mock).mockResolvedValue(issuanceDocument(clientId, 'invoice', 'draft'));
  (takeNumber.takeDocumentNumberForTransitionWithStatus as Mock).mockResolvedValue({
    document: issuanceDocument(clientId, 'invoice', 'validated'),
    numbered: { number: 1, displayNumber: 'INV-2026-0001' },
  });
  const handler = invoiceActionRegistry().resolve('invoice', 'validate')!;
  const outcome = await handler(draftInvoiceContext(companyId, clientId)).catch((error) => error);
  const response = outcome?.response;
  if (response?.code === CLIENT_INCOMPLETE_CODE) {
    return response.params.identifiers.map((identifier: { scheme: string }) => identifier.scheme);
  }
  if (response?.code === INVOICE_IDENTIFIERS_MISSING_CODE) {
    return response.params.missing
      .filter((identifier: { party: string }) => identifier.party === 'BUYER')
      .map((identifier: { scheme: string }) => identifier.scheme);
  }
  return [];
}

describe('a client is asked only for the identifiers its country requires of its type', () => {
  beforeAll(async () => {
    await seedCountryIdentifierRequirements(prisma);
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  });

  afterEach(() => vi.resetAllMocks());

  beforeEach(() => stubIssuanceCollaborators());

  it('covers every country file', () => {
    expect(COUNTRIES).toEqual(defaultCountryIdentifierRequirementsCatalog.countries());
  });

  it.each(CASES)(
    '$countryCode $type client: the form requires only what the country asks',
    async ({ countryCode, type }) => {
      const { requirements } = await resolveRequiredIdentifiers(countryCode, type);

      const required = requirements.filter((requirement) => requirement.required).map((r) => r.scheme);

      expect(required.toSorted()).toEqual(EXPECTED[countryCode].form[type].toSorted());
    },
  );

  it.each(CASES)(
    '$countryCode $type client: issuance asks only for what the invoice must carry',
    async ({ countryCode, type }) => {
      const { companyId, clientId } = await domesticSellerAndClient(countryCode, type);

      const asked = await clientIdentifiersAskedAtIssuance(companyId, clientId);

      expect(asked).toEqual(EXPECTED[countryCode].issuance[type]);
    },
  );
});
