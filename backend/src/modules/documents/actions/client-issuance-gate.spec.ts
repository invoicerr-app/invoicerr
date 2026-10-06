import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import * as b2gRouting from '../b2g-routing/b2g-routing';
import { seedCountryIdentifierRequirements } from '../country-identifiers/seed';
import * as countryPolicy from '../country-policy/country-policy';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import * as takeNumber from '../numbering/take-number';
import * as persistence from '../persistence';
import { EntityReferenceRegistry } from '../references/reference-registry';
import * as taxLoadAndResolve from '../tax/load-and-resolve';
import * as mandate from '../transports/channel-policy/mandate';
import * as companyTransport from '../transports/company-transport';
import { TransportRegistry } from '../transports/transport-registry';
import * as atcudIssuance from './atcud-issuance';
import { ActionRegistry } from './action-registry';
import { CLIENT_INCOMPLETE_CODE, findMissingClientFields } from './client-issuance-readiness';
import { registerInvoiceActions } from './invoice-actions';
import { registerQuoteActions } from './quote-actions';
import * as vatCurrencyIssuance from '../vat-currency/vat-currency-issuance';
import * as applyStockOnIssuance from '../stock/apply-stock-on-issuance';

vi.mock('../persistence');
vi.mock('../transports/company-transport');
vi.mock('../country-policy/country-policy');
vi.mock('../transports/channel-policy/mandate');
vi.mock('../b2g-routing/b2g-routing');
vi.mock('../numbering/take-number');
vi.mock('../tax/load-and-resolve');

const RESOLVED_COUNTRY = 'FR';

function documentFor(clientId: string, typeId: 'invoice' | 'quote', status: string) {
  return {
    id: 'doc-1',
    typeId,
    status,
    data: documentData(clientId),
    createdAt: new Date(),
    updatedAt: new Date(),
    number: status === 'draft' ? undefined : 1,
    displayNumber: status === 'draft' ? undefined : 'INV-2026-0001',
  };
}

function documentData(clientId: string) {
  return {
    client: clientId,
    issueDate: '2026-09-15',
    dueDate: '2026-09-30',
    currency: 'EUR',
    lines: [{ description: 'Consulting', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: '20' }],
  };
}

function ctxFor(clientId: string, currentStatus = 'draft') {
  return {
    companyId: companyId(),
    typeId: 'invoice',
    documentId: 'doc-1',
    data: documentData(clientId),
    params: {},
    currentStatus,
  };
}

let seededCompanyId = '';
const companyId = () => seededCompanyId;

function invoiceRegistry() {
  const transportRegistry = new TransportRegistry();
  transportRegistry.register('email', 'Email', { send: vi.fn().mockResolvedValue({ message: 'queued' }) });
  const registry = new ActionRegistry();
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: vi.fn() } });
  return registry;
}

async function rejection(promise: Promise<unknown>): Promise<{ message: string; response: any }> {
  try {
    await promise;
  } catch (error) {
    return error as { message: string; response: any };
  }
  throw new Error('expected the action to be refused');
}

describe('issuing an invoice requires a complete client; a quote does not', () => {
  let incompleteId = '';
  let completeId = '';

  beforeAll(async () => {
    await seedCountryIdentifierRequirements(prisma);
    const company = await prisma.company.create({
      data: {
        name: 'Issuance Gate Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 Test Street',
        postalCode: '75001',
        city: 'Paris',
        country: 'France',
        countryCode: RESOLVED_COUNTRY,
        phone: '+33100000000',
        email: `issuance-gate-${Date.now()}-${Math.random()}@example.com`,
      },
    });
    seededCompanyId = company.id;
    const incomplete = await prisma.client.create({
      data: { companyId: company.id, name: 'Name Only SARL', country: 'France', countryCode: 'FR' },
    });
    incompleteId = incomplete.id;
    const complete = await prisma.client.create({
      data: {
        companyId: company.id,
        name: 'Complete SARL',
        country: 'France',
        countryCode: 'FR',
        address: '2 Rue Complète',
        postalCode: '75002',
        city: 'Paris',
        partyIdentifiers: { create: { scheme: 'LEGAL_ID', value: '123456789' } },
      },
    });
    completeId = complete.id;
  });

  afterAll(async () => {
    await prisma.company.delete({ where: { id: seededCompanyId } }).catch(() => undefined);
  });

  afterEach(() => vi.resetAllMocks());

  beforeEach(() => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('DE');
    (mandate.activeChannelMandateForOperation as Mock).mockReturnValue(undefined);
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue('email');
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );
    (b2gRouting.resolveClientB2gRouting as Mock).mockResolvedValue({
      applies: false,
      missingIdentifierSchemes: [],
    });
    vi.spyOn(atcudIssuance, 'attachAtcudToNumberedDocument').mockResolvedValue(undefined);
    vi.spyOn(vatCurrencyIssuance, 'attachVatNationalCurrencyToNumberedDocument').mockResolvedValue(undefined);
    vi.spyOn(applyStockOnIssuance, 'applyStockOnIssuance').mockResolvedValue(undefined);
  });

  it('Validate is refused for a client with no address, city or catalog-required identifier, naming each', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(documentFor(incompleteId, 'invoice', 'draft'));
    const handler = invoiceRegistry().resolve('invoice', 'validate');

    const error = await rejection(handler!(ctxFor(incompleteId)));

    expect(error.message).toMatch(/Name Only SARL/);
    expect(error.message).toMatch(/address, city, SIREN \/ SIRET/);
    expect(error.response).toMatchObject({
      code: CLIENT_INCOMPLETE_CODE,
      params: {
        clientId: incompleteId,
        clientName: 'Name Only SARL',
        address: ['address', 'city'],
        identifiers: [{ scheme: 'LEGAL_ID', label: 'SIREN / SIRET' }],
      },
    });
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).not.toHaveBeenCalled();
  });

  it('Send is refused the same way, before any number is taken', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(documentFor(incompleteId, 'invoice', 'draft'));
    const handler = invoiceRegistry().resolve('invoice', 'send');

    const error = await rejection(handler!(ctxFor(incompleteId)));

    expect(error.response.code).toBe(CLIENT_INCOMPLETE_CODE);
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).not.toHaveBeenCalled();
  });

  it('Validate succeeds once the client carries its address, city and required identifier', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(documentFor(completeId, 'invoice', 'draft'));
    (takeNumber.takeDocumentNumberForTransitionWithStatus as Mock).mockResolvedValue({
      document: documentFor(completeId, 'invoice', 'validated'),
      numbered: { number: 1, displayNumber: 'INV-2026-0001' },
    });
    const handler = invoiceRegistry().resolve('invoice', 'validate');

    const result = await handler!(ctxFor(completeId));

    expect(result.changed).toBe(true);
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).toHaveBeenCalledTimes(1);
  });

  it('Send succeeds once the client is complete', async () => {
    const draft = documentFor(completeId, 'invoice', 'draft');
    (persistence.findOwnedDocument as Mock).mockResolvedValue(draft);
    (takeNumber.takeDocumentNumberForTransitionWithStatus as Mock).mockResolvedValue({
      document: documentFor(completeId, 'invoice', 'sending'),
      numbered: { number: 1, displayNumber: 'INV-2026-0001' },
    });
    const handler = invoiceRegistry().resolve('invoice', 'send');

    const result = await handler!(ctxFor(completeId));

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
  });

  it('a quote for the incomplete client still sends', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(documentFor(incompleteId, 'quote', 'draft'));
    (takeNumber.takeDocumentNumberForTransitionWithStatus as Mock).mockResolvedValue({
      document: documentFor(incompleteId, 'quote', 'sending'),
      numbered: { number: 1, displayNumber: 'QUOTE-2026-0001' },
    });
    (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue(undefined);
    const typeRegistry = new DocumentTypeRegistry();
    typeRegistry.register(buildQuoteDescriptor());
    const registry = new ActionRegistry();
    registerQuoteActions(registry, {
      clientsService: { getClientById: vi.fn().mockResolvedValue(null) } as never,
      mailService: { sendForCompany: vi.fn() } as never,
      typeRegistry,
      referenceRegistry: new EntityReferenceRegistry(),
      queueDispatcher: { enqueueAction: vi.fn() },
    });

    const result = await registry.resolve('quote', 'send')!({
      ...ctxFor(incompleteId),
      typeId: 'quote',
      params: { recipient: 'client@example.com' },
    });

    expect(result.changed).toBe(true);
  });
});

describe('findMissingClientFields', () => {
  const required = [{ scheme: 'LEGAL_ID', label: 'SIREN / SIRET' }];

  it('treats blank strings as missing', () => {
    const missing = findMissingClientFields(
      { address: '  ', city: '', partyIdentifiers: [{ scheme: 'LEGAL_ID', value: ' ' }] },
      required,
    );
    expect(missing).toEqual({ address: ['address', 'city'], identifiers: required });
  });

  it('reports nothing for a complete client', () => {
    const missing = findMissingClientFields(
      { address: '1 Rue', city: 'Paris', partyIdentifiers: [{ scheme: 'LEGAL_ID', value: '123456789' }] },
      required,
    );
    expect(missing).toEqual({ address: [], identifiers: [] });
  });
});
