/**
 * Portugal's ATCUD — the WIRING inside `invoice-actions.ts`'s "send": `country-policy/country-policy`
 * and `@/prisma/prisma.service` are both mocked here, the same style `invoice-channel-mandate.spec.ts`
 * already established for a different preflight gate on the same action. This file's job is "does
 * invoice-actions.ts's 'send' actually call the ATCUD preflight/onNumbered hooks correctly" — never
 * "is `parseAtcudPattern`/`computeAtcud` itself right" (that is `numbering/atcud.spec.ts`'s job) nor
 * "does `ensureAtcudIssuable`/`attachAtcudToNumberedInvoice` resolve a series correctly on their own"
 * (that is `atcud-issuance.spec.ts`'s job). Calls the registered "send" handler directly, bypassing
 * `DocumentsService.runAction`'s own gates entirely — the exact same style `send-divergence.spec.ts`
 * and `invoice-channel-mandate.spec.ts` already established for this module.
 */
import { vi, type Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import * as persistence from '../persistence';
import * as countryPolicy from '../country-policy/country-policy';
import * as takeNumber from '../numbering/take-number';
import * as b2gRouting from '../b2g-routing/b2g-routing';
import { TransportRegistry } from '../transports/transport-registry';
import * as companyTransport from '../transports/company-transport';
import { ActionRegistry } from './action-registry';
import { registerInvoiceActions } from './invoice-actions';
import * as taxLoadAndResolve from '../tax/load-and-resolve';
import prisma from '@/prisma/prisma.service';

vi.mock('../persistence');
vi.mock('../transports/company-transport');
vi.mock('../country-policy/country-policy');
vi.mock('../b2g-routing/b2g-routing');
vi.mock('../numbering/take-number');
vi.mock('../tax/load-and-resolve');
// This file's own concern is the ATCUD gate, never the (unrelated) SELLER-country channel mandate —
// see `invoice-channel-mandate.spec.ts` for that mechanism's own dedicated tests. Automocked
// (`activeChannelMandateFor` returns `undefined`, i.e. "no mandate") so a REAL mandate fact for
// whichever country a test happens to pick (e.g. FR, mandated from 2026-09-01 — see
// `invoice-channel-mandate.spec.ts`'s own `FR_MANDATE`) can never interfere with a test that has
// nothing to do with it.
vi.mock('../transports/channel-policy/mandate');
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    companyAtcudSeries: { findUnique: vi.fn() },
    documentInstance: { update: vi.fn() },
    log: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: Mock };
  companyAtcudSeries: { findUnique: Mock };
  documentInstance: { update: Mock };
};

const documentData = {
  client: 'client-1',
  issueDate: '2026-09-13',
  dueDate: '2026-09-30',
  currency: 'EUR',
  lines: [{ description: 'Consulting', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: '20' }],
};

function draftDocument() {
  return {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'draft',
    data: documentData,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildRegistry(transportRegistry = new TransportRegistry()) {
  transportRegistry.register('email', 'Email', { send: vi.fn() });
  const registry = new ActionRegistry();
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: vi.fn() } });
  return registry;
}

function sendAction() {
  const handler = buildRegistry().resolve('invoice', 'send');
  return handler!({
    companyId: 'company-1',
    typeId: 'invoice',
    documentId: 'doc-1',
    data: documentData,
    params: {},
  });
}

describe('invoice "send" — Portugal\'s ATCUD preflight and numbering-time attachment', () => {
  afterEach(() => vi.resetAllMocks());

  beforeEach(() => {
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue('email');
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );
    (b2gRouting.resolveClientB2gRouting as Mock).mockResolvedValue({
      applies: false,
      missingIdentifierSchemes: [],
    });
    (persistence.findOwnedDocument as Mock).mockResolvedValue(draftDocument());
  });

  it('is a complete no-op for a non-Portuguese company — never reads a number format, never blocks', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('FR');
    (persistence.upsertDocument as Mock).mockResolvedValue({
      ...draftDocument(),
      status: 'sending',
      number: null,
      displayNumber: null,
    });
    (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue({
      number: 1,
      displayNumber: 'INVOICE-2026-0001',
    });

    const result = await sendAction();

    expect(result.changed).toBe(true);
    expect(mockedPrisma.company.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.companyAtcudSeries.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.documentInstance.update).not.toHaveBeenCalled();
  });

  it('BLOCKS at the preflight for a Portuguese company on an ATCUD-incompatible number format — never persisted, never numbered', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('PT');
    mockedPrisma.company.findUnique.mockResolvedValue({ numberFormats: null }); // shipped default: no "/"

    const action = sendAction();

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    await expect(action).rejects.toThrow(/cannot produce a lawful ATCUD/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
    expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
  });

  it('BLOCKS at the preflight for a Portuguese company with a compatible format but no registered validation code', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('PT');
    mockedPrisma.company.findUnique.mockResolvedValue({ numberFormats: { invoice: 'FT {year}/{number:4}' } });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue(null);

    const action = sendAction();

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    await expect(action).rejects.toThrow(/No AT validation code is registered/);
    await expect(action).rejects.toThrow(/FT 2026/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
    expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
  });

  it('numbers, THEN computes and persists the ATCUD, for a fully-configured Portuguese company', async () => {
    (countryPolicy.resolveCompanyCountryCode as Mock).mockResolvedValue('PT');
    mockedPrisma.company.findUnique.mockResolvedValue({ numberFormats: { invoice: 'FT {year}/{number:4}' } });
    mockedPrisma.companyAtcudSeries.findUnique.mockResolvedValue({
      id: 'series-1',
      companyId: 'company-1',
      typeId: 'invoice',
      seriesId: 'FT 2026',
      validationCode: 'JCVPTS0J',
    });
    (persistence.upsertDocument as Mock).mockResolvedValue({
      ...draftDocument(),
      status: 'sending',
      number: null,
      displayNumber: null,
    });
    (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue({
      number: 7,
      displayNumber: 'FT 2026/0007',
    });

    const result = await sendAction();

    expect(result.changed).toBe(true);
    expect(mockedPrisma.documentInstance.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { atcud: 'ATCUD:JCVPTS0J-0007' },
    });
  });
});
