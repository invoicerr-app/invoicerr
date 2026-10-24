import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import * as atcudIssuance from './atcud-issuance';
import { draftInvoiceContext, issuanceDocument, rejection } from '../__tests__/invoice-action-harness';
import { createTestCompany } from '../__tests__/issuable-client';
import { ActionRegistry } from './action-registry';
import { registerInvoiceActions } from './invoice-actions';
import * as b2gRouting from '../b2g-routing/b2g-routing';
import { seedCountryIdentifierRequirements } from '../country-identifiers/seed';
import * as takeNumber from '../numbering/take-number';
import * as persistence from '../persistence';
import * as applyStockOnIssuance from '../stock/apply-stock-on-issuance';
import * as taxLoadAndResolve from '../tax/load-and-resolve';
import { TransportRegistry } from '../transports/transport-registry';
import * as vatCurrencyIssuance from '../vat-currency/vat-currency-issuance';

vi.mock('../tax/load-and-resolve');
vi.mock('../numbering/take-number');
vi.mock('../b2g-routing/b2g-routing');
vi.mock('../persistence');

type BuyerType = 'COMPANY' | 'INDIVIDUAL';

interface MandateCountry {
  country: string;
  countryCode: string;
  city: string;
  sellerIdentifiers: Record<string, string>;
  buyerIdentifiers: Record<BuyerType, Record<string, string>>;
  channel: string;
}

const FRANCE: MandateCountry = {
  country: 'France',
  countryCode: 'FR',
  city: 'Paris',
  sellerIdentifiers: { LEGAL_ID: '732829320', VAT: 'FR44732829320' },
  buyerIdentifiers: { COMPANY: { LEGAL_ID: '552100554' }, INDIVIDUAL: {} },
  channel: 'pdp',
};

const ITALY: MandateCountry = {
  country: 'Italy',
  countryCode: 'IT',
  city: 'Roma',
  sellerIdentifiers: { VAT: 'IT00743110157' },
  buyerIdentifiers: { COMPANY: { VAT: 'IT01114601006' }, INDIVIDUAL: { LEGAL_ID: 'RSSMRA80A01H501U' } },
  channel: 'sdi',
};

const createdCompanyIds: string[] = [];

const identifierRows = (identifiers: Record<string, string>) =>
  Object.entries(identifiers).map(([scheme, value]) => ({ scheme, value }));

async function sellerWithoutChannel(where: MandateCountry) {
  const company = await createTestCompany(`Seller ${where.countryCode} without channel`);
  createdCompanyIds.push(company.id);
  return prisma.company.update({
    where: { id: company.id },
    data: {
      country: where.country,
      countryCode: where.countryCode,
      city: where.city,
      invoiceTransportId: null,
      partyIdentifiers: { create: identifierRows(where.sellerIdentifiers) },
    },
  });
}

function buyer(companyId: string, where: MandateCountry, type: BuyerType) {
  return prisma.client.create({
    data: {
      companyId,
      name: `Buyer ${where.countryCode} ${type}`,
      type,
      address: '1 Client Street',
      postalCode: '00001',
      city: where.city,
      country: where.country,
      countryCode: where.countryCode,
      partyIdentifiers: { create: identifierRows(where.buyerIdentifiers[type]) },
    },
  });
}

function registry() {
  const transportRegistry = new TransportRegistry();
  transportRegistry.register('email', 'Email', { send: vi.fn().mockResolvedValue({ message: 'queued' }) });
  const actions = new ActionRegistry();
  registerInvoiceActions(actions, { transportRegistry, queueDispatcher: { enqueueAction: vi.fn() } });
  return actions;
}

async function validate(where: MandateCountry, buyerType: BuyerType) {
  const company = await sellerWithoutChannel(where);
  const client = await buyer(company.id, where, buyerType);
  (persistence.findOwnedDocument as Mock).mockResolvedValue(issuanceDocument(client.id, 'invoice', 'draft'));
  (takeNumber.takeDocumentNumberForTransitionWithStatus as Mock).mockResolvedValue({
    document: issuanceDocument(client.id, 'invoice', 'validated'),
    numbered: { number: 1, displayNumber: 'INV-2026-0001' },
  });
  return registry().resolve('invoice', 'validate')!(draftInvoiceContext(company.id, client.id));
}

async function transmissionPreview(where: MandateCountry, buyerType: BuyerType) {
  const company = await sellerWithoutChannel(where);
  const client = await buyer(company.id, where, buyerType);
  const preview = registry().resolveTransmissionPreview('invoice', 'validate')!;
  return preview({ companyId: company.id, data: draftInvoiceContext(company.id, client.id).data });
}

describe('Validate, against each shipped channel mandate, for a private and a business buyer', () => {
  beforeAll(async () => {
    await seedCountryIdentifierRequirements(prisma);
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
  });

  beforeEach(() => {
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as Mock).mockImplementation(
      async (_companyId: string, data: unknown) => ({ data, crossBorder: false, warnings: [] }),
    );
    (b2gRouting.resolveClientB2gRouting as Mock).mockResolvedValue({ applies: false });
    vi.spyOn(atcudIssuance, 'attachAtcudToNumberedDocument').mockResolvedValue(undefined as never);
    vi.spyOn(vatCurrencyIssuance, 'attachVatNationalCurrencyToNumberedDocument').mockResolvedValue(
      undefined as never,
    );
    vi.spyOn(applyStockOnIssuance, 'applyStockOnIssuance').mockResolvedValue(undefined as never);
  });

  afterEach(() => vi.resetAllMocks());

  it('France, private buyer: validates without a PDP', async () => {
    const result = await validate(FRANCE, 'INDIVIDUAL');

    expect(result.document).toMatchObject({ status: 'validated' });
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).toHaveBeenCalledWith(
      expect.any(String),
      'invoice',
      'doc-1',
      ['draft'],
      'validated',
      expect.any(Object),
    );
  });

  it('France, private buyer: the Validate dialog announces no transmission', async () => {
    expect(await transmissionPreview(FRANCE, 'INDIVIDUAL')).toEqual({ transmits: false });
  });

  it('France, business buyer: still refused without a PDP', async () => {
    const error = await rejection(validate(FRANCE, 'COMPANY'));

    expect(error.message).toMatch(/to go through the "pdp" channel/);
    expect(takeNumber.takeDocumentNumberForTransitionWithStatus).not.toHaveBeenCalled();
  });

  it('Italy, private buyer: still refused without SdI, the mandate covers consumers', async () => {
    const error = await rejection(validate(ITALY, 'INDIVIDUAL'));

    expect(error.message).toMatch(/to go through the "sdi" channel/);
  });

  it('Italy, business buyer: still refused without SdI', async () => {
    const error = await rejection(validate(ITALY, 'COMPANY'));

    expect(error.message).toMatch(/to go through the "sdi" channel/);
  });
});
