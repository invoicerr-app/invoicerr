import { vi, type Mock } from 'vitest';
import { NotImplementedException } from '@nestjs/common';

import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import * as takeNumber from '../numbering/take-number';
import { EntityReferenceRegistry } from '../references/reference-registry';
import * as renderInstancePdf from '../rendering/render-instance-pdf';
import * as companyTransport from '../transports/company-transport';
import * as persistence from '../persistence';
import { TransportRegistry } from '../transports/transport-registry';
import { ActionRegistry } from './action-registry';
import * as companyEmailTemplates from './company-email-templates';
import { registerInvoiceActions } from './invoice-actions';
import { registerQuoteActions } from './quote-actions';
import * as taxLoadAndResolve from '../tax/load-and-resolve';
import * as b2gRouting from '../b2g-routing/b2g-routing';

vi.mock('../persistence');
vi.mock('../transports/company-transport');
// The quote's "send" now renders+attaches a PDF (send-document-email.ts) — mocked at its own entry
// point for the same reason `../persistence` is: this file is about WHICH path each type's "send"
// takes, not PDF rendering or Puppeteer (that is send-document-email.spec.ts's job).
vi.mock('../rendering/render-instance-pdf');
vi.mock('../numbering/take-number');
vi.mock('./company-email-templates');
// Country channel mandate — `invoice-actions.ts`'s "send" now ALSO resolves the company's own country
// (`resolveCompanyCountryCode`) to check for a channel mandate. Mocked here for the same reason
// `documents.service.invoice.spec.ts` already mocks this module wholesale: the real function reaches
// Prisma directly, which this file (no Nest, no DB) cannot provide. Automocked to `undefined` by
// default — no country resolves, so no mandate is ever found, and every test below keeps meaning
// exactly what it always did (none of them exercises a mandated country on purpose; that is
// `invoice-channel-mandate.spec.ts`'s own job).
vi.mock('../country-policy/country-policy');
// Cross-border VAT ("transfrontalier") — `invoice-actions.ts`'s "send" now ALSO resolves cross-
// border VAT (`tax/load-and-resolve.ts`), which reaches Prisma directly, same reason as
// `country-policy` above. A FACTORY mock (not an automock) — a permissive pass-through — because,
// unlike `country-policy`'s own "automocked to undefined is already the neutral case", an automocked
// `undefined` return here would throw on `.data` inside `invoice-actions.ts`'s own deliver/preflight
// wrappers: this file is about WHICH path each type's "send" takes, never about cross-border tax,
// which is `tax/resolve-invoice-tax.spec.ts` and `tax/cross-border-formats.spec.ts`'s own job.
vi.mock('../tax/load-and-resolve');
// B2G routing (`b2g-routing/`) reaches Prisma directly too, same reason as `country-policy` above.
// Unlike `country-policy` (an automocked `undefined` country code IS the neutral case), this one
// MUST be given an explicit `{ applies: false }` in `beforeEach` below — `invoice-actions.ts` reads
// `b2g.applies` off the resolved value, and an automocked bare `undefined` would throw before ever
// reaching the divergence this file actually tests. No test here uses a GOVERNMENT client — see
// `invoice-b2g-routing.spec.ts` for that mechanism's own dedicated suite.
vi.mock('../b2g-routing/b2g-routing');

/**
 * Guardrail against the exact mistake this branch once made: generic-actions.ts used to export a
 * single `registerSendAction` shared by BOTH the quote and the invoice, on a "reuse, don't duplicate"
 * reading that turned out to be wrong — a quote always sends by email, an invoice's transport is
 * a company setting. This file proves the two "send" actions run through genuinely DIFFERENT code —
 * not just two functions that happen to produce the same result — so a future refactor that quietly
 * re-merges them makes THIS file go red. That is deliberate.
 *
 * Both "send"s are now ASYNCHRONOUS (actions/async-send.ts) — this file calls each
 * type's registered handler directly (bypassing DocumentsService.runAction's own gates entirely, same
 * as it always did), so every test here sets `findOwnedDocument`'s mock explicitly to whichever phase
 * it means to exercise ("draft" for phase 1 — enqueue; "sending" for phase 2 — the worker's replay,
 * which is where each type's own divergence — MailService vs. TransportRegistry — actually happens).
 */
describe('quote "send" and invoice "send" do not share a path', () => {
  afterEach(() => vi.resetAllMocks());
  // Cross-border VAT — see this file's own `vi.mock('../tax/load-and-resolve')` comment above.
  // Re-installed in `beforeEach`, not just once, because `afterEach`'s own `vi.resetAllMocks()`
  // wipes it after every test — the SAME discipline `documents.service.invoice.spec.ts` already
  // holds for this exact mock.
  beforeEach(() => {
    (taxLoadAndResolve.resolveInvoiceCrossBorderTaxForCompany as Mock).mockImplementation(
      (_companyId: string, data: Record<string, unknown>) =>
        Promise.resolve({ data, crossBorder: false, warnings: [] }),
    );
    (b2gRouting.resolveClientB2gRouting as Mock).mockResolvedValue({
      applies: false,
      missingIdentifierSchemes: [],
    });
  });

  const documentData = {
    client: 'client-1',
    issueDate: '2026-01-01',
    currency: 'EUR',
    lines: [{ description: 'Widget', quantity: 1, unit: 'unit', unitPrice: 10, vatRate: '20' }],
  };

  it("the quote's send NEVER consults the company's transport configuration, and (in phase 2) calls MailService directly", async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'sending',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (persistence.updateDocumentStatus as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'sent',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (renderInstancePdf.renderDocumentInstance as Mock).mockResolvedValue({
      pdf: Buffer.from('%PDF-fake'),
      totals: {
        currency: 'EUR',
        lines: [],
        netMinor: 0,
        vatMinor: 0,
        grossMinor: 0,
        vatBreakdown: [],
        warnings: [],
      },
      referenceLabels: {},
      companyName: 'Test Co',
    });
    (companyEmailTemplates.getCompanyDocumentEmailTemplates as Mock).mockResolvedValue({});
    (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue(undefined);

    const mailService = { sendForCompany: vi.fn().mockResolvedValue({ message: 'ok' }) };
    const clientsService = { getClientById: vi.fn().mockResolvedValue(null) };
    const typeRegistry = new DocumentTypeRegistry();
    typeRegistry.register(buildQuoteDescriptor());
    const referenceRegistry = new EntityReferenceRegistry();
    const queueDispatcher = { enqueueAction: vi.fn() };
    const registry = new ActionRegistry();
    registerQuoteActions(registry, {
      clientsService: clientsService as never,
      mailService: mailService as never,
      typeRegistry,
      referenceRegistry,
      queueDispatcher,
    });

    const handler = registry.resolve('quote', 'send');
    await handler!({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'doc-1',
      data: documentData,
      params: { recipient: 'client@example.com' },
    });

    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ to: 'client@example.com' }),
    );
    expect(companyTransport.getCompanyInvoiceTransportId).not.toHaveBeenCalled();
  });

  it("the invoice's send NEVER calls MailService directly — it always goes through the company's chosen transport", async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'sending',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (persistence.updateDocumentStatus as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'sent',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue('fake-transport');

    const fakeTransport = {
      send: vi.fn().mockResolvedValue({ message: 'delivered by the fake transport' }),
    };
    const transportRegistry = new TransportRegistry();
    transportRegistry.register('fake-transport', 'Fake', fakeTransport);

    const registry = new ActionRegistry();
    registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: vi.fn() } });

    const handler = registry.resolve('invoice', 'send');
    const result = await handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    expect(fakeTransport.send).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 'company-1', label: 'Invoice' }),
    );
    expect(result.message).toBe('delivered by the fake transport');
  });

  it('the quote (phase 1, "draft") persists "sending" and enqueues — never touches the transport registry either', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'draft',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (persistence.upsertDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'sending',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mailService = { sendForCompany: vi.fn() };
    const clientsService = { getClientById: vi.fn() };
    const typeRegistry = new DocumentTypeRegistry();
    typeRegistry.register(buildQuoteDescriptor());
    const referenceRegistry = new EntityReferenceRegistry();
    const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };
    const registry = new ActionRegistry();
    registerQuoteActions(registry, {
      clientsService: clientsService as never,
      mailService: mailService as never,
      typeRegistry,
      referenceRegistry,
      queueDispatcher,
    });

    const handler = registry.resolve('quote', 'send');
    await handler!({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'doc-1',
      data: documentData,
      params: { recipient: 'client@example.com' },
    });

    expect(mailService.sendForCompany).not.toHaveBeenCalled();
    expect(queueDispatcher.enqueueAction).toHaveBeenCalledWith(
      expect.objectContaining({ typeId: 'quote', actionId: 'send' }),
    );
  });

  it('the invoice BLOCKS with a clear 501 when the company has configured NO transport — never a silent fallback to email', async () => {
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue(null);
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const transportRegistry = new TransportRegistry();
    // Registering "email" here on purpose: even when a transport DOES exist in the registry, an
    // unconfigured company must still block — availability of a transport is not the same as a
    // company having CHOSEN one.
    transportRegistry.register('email', 'Email', { send: vi.fn() });

    const registry = new ActionRegistry();
    registerInvoiceActions(registry, { transportRegistry, queueDispatcher: { enqueueAction: vi.fn() } });

    const handler = registry.resolve('invoice', 'send');
    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/no transport is configured/i);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('the invoice BLOCKS just as clearly when it is configured for a transport nobody registered', async () => {
    (companyTransport.getCompanyInvoiceTransportId as Mock).mockResolvedValue('long-since-removed');
    (persistence.findOwnedDocument as Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const registry = new ActionRegistry();
    registerInvoiceActions(registry, {
      transportRegistry: new TransportRegistry(),
      queueDispatcher: { enqueueAction: vi.fn() },
    });

    const handler = registry.resolve('invoice', 'send');
    const action = handler!({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: documentData,
      params: {},
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/long-since-removed/);
  });

  it("only the quote's send declares a params-defaults resolver for a typed recipient — the invoice's send has none", () => {
    const clientsService = { getClientById: vi.fn() };
    const mailService = { sendForCompany: vi.fn() };

    const registry = new ActionRegistry();
    registerQuoteActions(registry, {
      clientsService: clientsService as never,
      mailService: mailService as never,
      typeRegistry: new DocumentTypeRegistry(),
      referenceRegistry: new EntityReferenceRegistry(),
      queueDispatcher: { enqueueAction: vi.fn() },
    });
    registerInvoiceActions(registry, {
      transportRegistry: new TransportRegistry(),
      queueDispatcher: { enqueueAction: vi.fn() },
    });

    expect(registry.resolveParamsDefaults('quote', 'send')).toBeDefined();
    expect(registry.resolveParamsDefaults('invoice', 'send')).toBeUndefined();
  });
});
