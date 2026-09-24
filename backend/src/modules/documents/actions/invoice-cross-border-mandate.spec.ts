/**
 * The scenario a user is actually hitting: a FRENCH company invoicing an ITALIAN client, issued
 * after 2026-09-01. Before this file's own fix the product refused the send outright, because
 * `channel-policy/mandate.ts` decided the FR/PDP mandate from the SELLER's country and the date
 * alone — while CGI art. 289 bis binds emission through a plateforme agréée only between taxable
 * persons established in France, and Italy's D.Lgs. 127/2015 art. 1 comma 3 binds SdI invoicing only
 * between subjects established in Italy. Neither mandate reaches a French supplier invoicing an
 * Italian buyer.
 *
 * ## Why this file exists NEXT TO `invoice-channel-mandate.spec.ts` rather than inside it
 *
 * That file mocks `channel-policy/mandate` WHOLESALE — deliberately, see its own header: its job is
 * "does invoice-actions.ts react correctly to a mandate DECISION", not "is the decision right". A
 * mocked resolver can never prove that the SHIPPED `fr.json` stops binding a cross-border invoice,
 * because the mock is what decides. This file therefore mocks NEITHER `channel-policy/mandate` NOR
 * `country-policy/country-policy`: the real catalog is loaded from the real `data/fr.json`, the real
 * country resolution runs, and only PRISMA is stubbed — so the seller's country, the buyer's country
 * and the shipped mandate fact all travel the exact path a real "send" takes.
 *
 * Every other collaborator is mocked for the reasons the neighbouring spec files already give:
 * persistence/numbering (no DB), b2g-routing (no government client here — a B2G rule would
 * short-circuit the whole mandate check, see `invoice-b2g-routing.spec.ts`), and cross-border tax (a
 * pass-through; `tax/resolve-invoice-tax.spec.ts` owns that decision).
 */
import { vi, type Mock } from 'vitest';
import { NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import * as persistence from '../persistence';
import * as b2gRouting from '../b2g-routing/b2g-routing';
import { TransportRegistry } from '../transports/transport-registry';
import * as companyTransport from '../transports/company-transport';
import { ActionRegistry } from './action-registry';
import { registerInvoiceActions } from './invoice-actions';
import * as taxLoadAndResolve from '../tax/load-and-resolve';

vi.mock('../persistence');
vi.mock('../transports/company-transport');
vi.mock('../b2g-routing/b2g-routing');
vi.mock('../numbering/take-number');
vi.mock('../tax/load-and-resolve');
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    client: { findFirst: vi.fn() },
    log: { create: vi.fn().mockResolvedValue({}) },
  },
}));

const documentData = {
  client: 'client-1',
  // AFTER the FR/PDP mandate's own `mandatedFrom` (2026-09-01, `channel-policy/data/fr.json`) — the
  // whole point: the mandate IS in force for this date, and still must not bind this operation.
  issueDate: '2026-09-15',
  dueDate: '2026-10-15',
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

function sendingDocument() {
  return { ...draftDocument(), status: 'sending' };
}

/** The seller is FRENCH in every test below — only the BUYER changes. */
function frenchCompany() {
  (prisma.company.findUnique as Mock).mockResolvedValue({ country: 'France', countryCode: 'FR' });
}

function clientEstablishedIn(countryCode: string | null, country: string | null = null) {
  (prisma.client.findFirst as Mock).mockResolvedValue({ country, countryCode });
}

function buildRegistry(transportRegistry: TransportRegistry) {
  const registry = new ActionRegistry();
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: vi.fn() } });
  return registry;
}

function emailOnlyRegistry() {
  const transportRegistry = new TransportRegistry();
  transportRegistry.register('email', 'Email', { send: vi.fn(), preflight: vi.fn() });
  return transportRegistry;
}

function send(transportRegistry: TransportRegistry) {
  const handler = buildRegistry(transportRegistry).resolve('invoice', 'send');
  return handler!({
    companyId: 'company-1',
    typeId: 'invoice',
    documentId: 'doc-1',
    data: documentData,
    params: {},
  });
}

describe('invoice "send" — a national channel mandate governs DOMESTIC operations only', () => {
  afterEach(() => vi.resetAllMocks());

  beforeEach(() => {
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );
    (b2gRouting.resolveClientB2gRouting as Mock).mockResolvedValue({
      applies: false,
      missingIdentifierSchemes: [],
    });
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue('email');
    (persistence.findOwnedDocument as Mock).mockResolvedValue(draftDocument());
    (persistence.upsertDocument as Mock).mockResolvedValue(sendingDocument());
  });

  // DIRECTION 1 — unchanged behaviour. This is the test that must fail the instant the narrowing is
  // widened into "a mandate never binds anything": FR -> FR is exactly what CGI art. 289 bis covers.
  it('FR seller -> FR client, issued after 2026-09-01: STILL BLOCKED, the PDP mandate applies unchanged', async () => {
    frenchCompany();
    clientEstablishedIn('FR', 'France');

    const action = send(emailOnlyRegistry());

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/FR requires invoices issued on or after 2026-09-01/);
    await expect(action).rejects.toThrow(/"pdp" channel/);
    await expect(action).rejects.toThrow(/plateforme agréée/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  // DIRECTION 2 — the live bug. Same seller, same date, same transport, only the buyer's country
  // differs, and the send now goes through.
  it('FR seller -> IT client, issued after 2026-09-01: NOT BLOCKED, the French invoicing mandate does not reach this operation', async () => {
    frenchCompany();
    clientEstablishedIn('IT', 'Italy');

    const result = await send(emailOnlyRegistry());

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'sending' });
  });

  it("the buyer's country is read from its free-text `country` too, not only from `countryCode`", async () => {
    frenchCompany();
    clientEstablishedIn(null, 'Italy');

    const result = await send(emailOnlyRegistry());

    expect(result.changed).toBe(true);
  });

  // FAIL-CLOSED, stated as a test rather than only as a comment: "we could not tell where the buyer
  // is" must never be the thing that lets an invoice out through an unlawful channel. See
  // `mandate.ts#isDomestic`.
  it('an UNRESOLVABLE buyer country keeps the mandate binding — an unknown client never disarms a legal block', async () => {
    frenchCompany();
    clientEstablishedIn(null, 'Nowhereland');

    const action = send(emailOnlyRegistry());

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/"pdp" channel/);
  });

  it('a client belonging to ANOTHER company resolves to no country at all, and therefore does NOT disarm the mandate', async () => {
    frenchCompany();
    // What `findFirst` returns when the id names another tenant's client: the `companyId` scope
    // matches nothing. See `country-policy.ts#resolveClientCountryCode`'s own header.
    (prisma.client.findFirst as Mock).mockResolvedValue(null);

    const action = send(emailOnlyRegistry());

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/"pdp" channel/);
  });

  // The rule is GENERAL, not a French special case — Italy's own mandate carries the same statutory
  // "residenti o stabiliti nel territorio dello Stato" restriction and is narrowed by the same
  // `scope.parties` fact in `channel-policy/data/it.json`.
  it('IT seller -> IT client: STILL BLOCKED (the SdI mandate applies), IT seller -> FR client: NOT BLOCKED', async () => {
    (prisma.company.findUnique as Mock).mockResolvedValue({ country: 'Italy', countryCode: 'IT' });
    clientEstablishedIn('IT', 'Italy');

    const domestic = send(emailOnlyRegistry());
    await expect(domestic).rejects.toBeInstanceOf(NotImplementedException);
    await expect(domestic).rejects.toThrow(/"sdi" channel/);

    clientEstablishedIn('FR', 'France');
    const crossBorder = await send(emailOnlyRegistry());
    expect(crossBorder.changed).toBe(true);
  });
});
