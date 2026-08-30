import { NotImplementedException } from '@nestjs/common';

import { ActionRegistry } from './action-registry';
import { registerInvoiceActions } from './invoice-actions';
import { registerQuoteActions } from './quote-actions';
import * as companyTransport from '../transports/company-transport';
import * as persistence from '../persistence';
import { TransportRegistry } from '../transports/transport-registry';

jest.mock('../persistence');
jest.mock('../transports/company-transport');

/**
 * Guardrail against the exact mistake this branch once made: generic-actions.ts used to export a
 * single `registerSendAction` shared by BOTH the quote and the invoice, on a "réutilise, ne duplique
 * pas" reading that turned out to be wrong — a quote always sends by email, an invoice's transport is
 * a company setting. This file proves the two "send" actions run through genuinely DIFFERENT code —
 * not just two functions that happen to produce the same result — so a future refactor that quietly
 * re-merges them makes THIS file go red. That is deliberate: the task that fixed this asked for
 * exactly that property.
 */
describe('quote "send" and invoice "send" do not share a path', () => {
  afterEach(() => jest.resetAllMocks());

  const documentData = {
    client: 'client-1',
    issueDate: '2026-01-01',
    currency: 'EUR',
    lines: [{ description: 'Widget', quantity: 1, unitPrice: 10 }],
  };

  it("the quote's send NEVER consults the company's transport configuration, and calls MailService directly", async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'sent',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const mailService = { sendMail: jest.fn().mockResolvedValue({ message: 'ok' }) };
    const clientsService = { getClientById: jest.fn().mockResolvedValue(null) };
    const registry = new ActionRegistry();
    registerQuoteActions(registry, {
      clientsService: clientsService as never,
      mailService: mailService as never,
    });

    const handler = registry.resolve('quote', 'send');
    await handler!({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'doc-1',
      data: documentData,
      params: { recipient: 'client@example.com' },
    });

    expect(mailService.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'client@example.com' }));
    expect(companyTransport.getCompanyInvoiceTransportId).not.toHaveBeenCalled();
  });

  it("the invoice's send NEVER calls MailService directly — it always goes through the company's chosen transport", async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'sent',
      data: documentData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('fake-transport');

    const fakeTransport = {
      send: jest.fn().mockResolvedValue({ message: 'delivered by the fake transport' }),
    };
    const transportRegistry = new TransportRegistry();
    transportRegistry.register('fake-transport', 'Fake', fakeTransport);

    const registry = new ActionRegistry();
    registerInvoiceActions(registry, { transportRegistry });

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

  it('the invoice BLOCKS with a clear 501 when the company has configured NO transport — never a silent fallback to email', async () => {
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue(null);

    const transportRegistry = new TransportRegistry();
    // Registering "email" here on purpose: even when a transport DOES exist in the registry, an
    // unconfigured company must still block — availability of a transport is not the same as a
    // company having CHOSEN one.
    transportRegistry.register('email', 'Email', { send: jest.fn() });

    const registry = new ActionRegistry();
    registerInvoiceActions(registry, { transportRegistry });

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
    (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('long-since-removed');

    const registry = new ActionRegistry();
    registerInvoiceActions(registry, { transportRegistry: new TransportRegistry() });

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
    const clientsService = { getClientById: jest.fn() };
    const mailService = { sendMail: jest.fn() };

    const registry = new ActionRegistry();
    registerQuoteActions(registry, {
      clientsService: clientsService as never,
      mailService: mailService as never,
    });
    registerInvoiceActions(registry, { transportRegistry: new TransportRegistry() });

    expect(registry.resolveParamsDefaults('quote', 'send')).toBeDefined();
    expect(registry.resolveParamsDefaults('invoice', 'send')).toBeUndefined();
  });
});
