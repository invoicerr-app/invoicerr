import { BadRequestException, ConflictException, NotImplementedException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerInvoiceActions } from './actions/invoice-actions';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as companyTransport from './transports/company-transport';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
jest.mock('./transports/company-transport');

/**
 * Same wiring discipline as documents.service.spec.ts's quote coverage, applied to the invoice — the
 * SECOND document type written entirely as a descriptor (invoice.descriptor.ts). What this file
 * exists to prove is not "does DocumentsService work" (already proven for the quote) but "does the
 * exact same generic machinery work UNMODIFIED for an independently-declared second type": no branch
 * of DocumentsService, validateAgainstDescriptor, or ActionRegistry knows the word "invoice" — it is
 * only ever data these registries were handed.
 *
 * The invoice's "send" is deliberately NOT the quote's mechanism (see actions/invoice-actions.ts and
 * actions/send-divergence.spec.ts) — the transport is read from `Company.invoiceTransportId`
 * (transports/company-transport.ts), mocked here the same way persistence.ts already is.
 */
function buildService(transportRegistry: TransportRegistry = new TransportRegistry()) {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const actionRegistry = new ActionRegistry();
  registerInvoiceActions(actionRegistry, { transportRegistry });
  // "record-payment" is NOT registered here, on purpose — see invoice.descriptor.ts.

  const actionExtensionRegistry = new ActionExtensionRegistry();
  const referenceRegistry = new EntityReferenceRegistry();

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    actionExtensionRegistry,
    referenceRegistry,
    transportRegistry,
  );
  return { service };
}

const validInvoiceData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  dueDate: '2026-01-31',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unitPrice: 9.9 }],
};

const noDueDateInvoiceData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unitPrice: 9.9 }],
};

describe('DocumentsService — the invoice type, the SECOND descriptor-only type', () => {
  afterEach(() => jest.resetAllMocks());

  it('is registered', () => {
    expect(buildService().service.listTypes()).toEqual([{ id: 'invoice', label: 'Invoice' }]);
  });

  it('its fields validate: a complete invoice is accepted', async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft',
      data: validInvoiceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    const result = await service.runAction('company-1', 'invoice', 'save-draft', {
      data: validInvoiceData,
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ id: 'doc-1', status: 'draft' });
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      undefined,
      'draft',
      validInvoiceData,
    );
  });

  it('its fields validate: an empty invoice is rejected before ever touching persistence', async () => {
    await expect(
      buildService().service.runAction('company-1', 'invoice', 'save-draft', { data: {} }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  // The one requiredness difference from the quote (quote.descriptor.ts's dueDate is optional) —
  // same 'date' kind, no new kind needed, just a different `required` on this descriptor. The
  // per-field message lives in the exception's response body (`errors`), not in `.message` itself —
  // see documents.service.ts's runAction, which always throws the generic "Invalid document data"
  // as the top-level message and carries the per-field detail alongside it.
  it('requires a due date — unlike the quote, where it is optional', async () => {
    const { service } = buildService();
    expect.assertions(2);

    try {
      await service.runAction('company-1', 'invoice', 'save-draft', { data: noDueDateInvoiceData });
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        errors: { key: string; message: string }[];
      };
      expect(response.errors).toEqual(
        expect.arrayContaining([{ key: 'dueDate', message: '"Due date" is required.' }]),
      );
    }
  });

  describe('"origin" — a MULTI-TARGET reference (quote OR invoice), unlike "client"', () => {
    it('accepts an origin pointing at a quote', async () => {
      const dataWithOrigin = { ...validInvoiceData, origin: { entity: 'quote', id: 'quote-doc-1' } };
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: dataWithOrigin,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const result = await service.runAction('company-1', 'invoice', 'save-draft', {
        data: dataWithOrigin,
      });

      expect(result.changed).toBe(true);
    });

    it('accepts an origin pointing at ANOTHER invoice — the second declared target', async () => {
      const dataWithOrigin = { ...validInvoiceData, origin: { entity: 'invoice', id: 'invoice-doc-0' } };
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: dataWithOrigin,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const result = await service.runAction('company-1', 'invoice', 'save-draft', {
        data: dataWithOrigin,
      });

      expect(result.changed).toBe(true);
    });

    it('rejects an origin naming an entity that was never declared as a target', async () => {
      const dataWithOrigin = { ...validInvoiceData, origin: { entity: 'client', id: 'client-1' } };

      expect.assertions(3);
      try {
        await buildService().service.runAction('company-1', 'invoice', 'save-draft', {
          data: dataWithOrigin,
        });
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        const response = (error as BadRequestException).getResponse() as {
          errors: { key: string; message: string }[];
        };
        expect(response.errors).toContainEqual(
          expect.objectContaining({ key: 'origin', message: expect.stringMatching(/quote, invoice/) }),
        );
      }
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('rejects the OLD bare-id shape — a plain string is no longer enough once more than one target is possible', async () => {
      const dataWithOrigin = { ...validInvoiceData, origin: 'quote-doc-1' };

      await expect(
        buildService().service.runAction('company-1', 'invoice', 'save-draft', { data: dataWithOrigin }),
      ).rejects.toThrow(/Invalid document data/);
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });
  });

  // The behaviour the task explicitly asks to keep proven on THIS second type, not only on the
  // quote's "convert-to-invoice": a real, declared action on the real invoice descriptor, genuinely
  // never registered (invoice-actions.ts), is blocked with a clear 501 — never a silent no-op.
  it('blocks "record-payment" — declared, no implementation registered — with a clear 501', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'sent',
      data: validInvoiceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    const action = service.runAction('company-1', 'invoice', 'record-payment', {
      documentId: 'doc-1',
      data: validInvoiceData,
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/no registered implementation/);
  });

  it('refuses "record-payment" for a status outside its availableWhen list — 409, not a silent bypass', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft',
      data: validInvoiceData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    await expect(
      service.runAction('company-1', 'invoice', 'record-payment', {
        documentId: 'doc-1',
        data: validInvoiceData,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('"send" — reads the company\'s OWN transport configuration, not the quote\'s email mechanism', () => {
    it('blocks with a 501 when the company has not configured a transport', async () => {
      (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue(null);
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: validInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const action = service.runAction('company-1', 'invoice', 'send', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      await expect(action).rejects.toBeInstanceOf(NotImplementedException);
      await expect(action).rejects.toThrow(/no transport is configured/i);
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('delivers through the configured transport and marks the document "sent"', async () => {
      (companyTransport.getCompanyInvoiceTransportId as jest.Mock).mockResolvedValue('email');
      const transportRegistry = new TransportRegistry();
      const fakeTransport = {
        send: jest.fn().mockResolvedValue({ message: 'Invoice sent to client-1@example.com.' }),
      };
      transportRegistry.register('email', 'Email', fakeTransport);

      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: validInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sent',
        data: validInvoiceData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService(transportRegistry);
      const result = await service.runAction('company-1', 'invoice', 'send', {
        documentId: 'doc-1',
        data: validInvoiceData,
      });

      expect(result.changed).toBe(true);
      expect(result.document).toMatchObject({ id: 'doc-1', status: 'sent' });
      expect(result.message).toBe('Invoice sent to client-1@example.com.');
      expect(fakeTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'company-1', label: 'Invoice' }),
      );
    });

    it('declares no params — there is no user-typed recipient, unlike the quote\'s "send"', () => {
      const descriptor = buildService().service.getType('invoice');
      const sendAction = descriptor.actions.find((a) => a.id === 'send');
      expect(sendAction?.params ?? []).toEqual([]);
    });
  });
});
