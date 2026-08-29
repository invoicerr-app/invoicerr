import { ConflictException, NotImplementedException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerDuplicateExtension } from './actions/duplicate-extension';
import { registerQuoteActions } from './actions/quote-actions';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';

jest.mock('./persistence');

/**
 * Wires the SAME building blocks documents.module.ts wires (real quote descriptor, real core field
 * kinds, real quote action registration, real "duplicate" third-party extension) directly into
 * `new DocumentsService(...)`, the way every other test in this codebase constructs a service — no
 * Nest TestingModule needed. Only the Prisma boundary (persistence.ts) is mocked, so this never
 * touches a real database; `mailService` is a fake so this never touches real SMTP either — the real
 * SMTP round-trip is send-quote.live.spec.ts, not this file (see MEMORY on why a green mocked suite
 * alone is never evidence of a working external integration).
 */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const clientsService = { getClientById: jest.fn().mockResolvedValue(null) };
  const mailService = { sendMail: jest.fn().mockResolvedValue({ message: 'Email sent successfully' }) };

  const actionRegistry = new ActionRegistry();
  registerQuoteActions(actionRegistry, {
    clientsService: clientsService as never,
    mailService: mailService as never,
  });
  // "convert-to-invoice" is NOT registered here, on purpose — see quote-actions.ts.

  const actionExtensionRegistry = new ActionExtensionRegistry();
  // Exactly what documents.module.ts does to attach a third-party action to an EXISTING type: no
  // edit to quote.descriptor.ts or quote-actions.ts was needed to add this.
  registerDuplicateExtension('quote', actionExtensionRegistry, actionRegistry);

  const referenceRegistry = new EntityReferenceRegistry();

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    actionExtensionRegistry,
    referenceRegistry,
  );
  return { service, clientsService, mailService };
}

const validQuoteData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unitPrice: 9.9 }],
};

describe('DocumentsService — the quote type, wired exactly as documents.module.ts wires it', () => {
  afterEach(() => jest.resetAllMocks());

  it('lists the quote type', () => {
    expect(buildService().service.listTypes()).toEqual([{ id: 'quote', label: 'Quote' }]);
  });

  it('rejects an unknown document type instead of returning something empty', () => {
    expect(() => buildService().service.getType('invoice')).toThrow(/Unknown document type "invoice"/);
  });

  it('runs "save-draft": implemented, validated, and persisted through the shared persistence layer', async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'draft',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    const result = await service.runAction('company-1', 'quote', 'save-draft', { data: validQuoteData });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ id: 'doc-1', status: 'draft' });
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'quote',
      undefined,
      'draft',
      validQuoteData,
    );
  });

  it('blocks "save-draft" on invalid data before ever touching persistence', async () => {
    await expect(
      buildService().service.runAction('company-1', 'quote', 'save-draft', { data: {} }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  // The behaviour the task calls "must be BLOCKED and say so": "convert-to-invoice" is a real,
  // declared action on the real quote descriptor, and genuinely has no implementation registered
  // (quote-actions.ts). This is not a synthetic double standing in for the mechanism — it IS the
  // mechanism, exercised through the exact wiring documents.module.ts uses. It replaces "send" in
  // this role now that "send" has a real implementation (see the "send" describe block below).
  it('blocks "convert-to-invoice" — declared, no implementation registered — with a clear 501', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'draft',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    const action = service.runAction('company-1', 'quote', 'convert-to-invoice', {
      documentId: 'doc-1',
      data: validQuoteData,
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/no registered implementation/);
  });

  it('blocks "send" before the document is even saved — it has no status to match "draft" yet', async () => {
    await expect(
      buildService().service.runAction('company-1', 'quote', 'send', { data: validQuoteData }),
    ).rejects.toThrow(/not available before the document has been saved/);
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
  });

  // The 409 the task explicitly asks to keep proven: a scripted client cannot get further than the
  // UI would by posting directly for a status the action does not allow. "sent" is a real status a
  // quote can be in, and "convert-to-invoice" genuinely requires "draft" or "sent" — this uses a
  // status OUTSIDE that list, so the request must be refused before the 501 check is ever reached.
  it('refuses an action for a status outside its availableWhen list — 409, not a silent bypass', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'archived',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    const action = service.runAction('company-1', 'quote', 'convert-to-invoice', {
      documentId: 'doc-1',
      data: validQuoteData,
    });

    await expect(action).rejects.toBeInstanceOf(ConflictException);
    await expect(action).rejects.toThrow(/not available for a document with status "archived"/);
  });

  it('rejects an action nobody declared on this type at all', async () => {
    await expect(
      buildService().service.runAction('company-1', 'quote', 'archive', { data: validQuoteData }),
    ).rejects.toThrow(/has no action "archive"/);
  });

  describe('"send" — implemented through the generic action mechanism, no special case', () => {
    it('validates its own params with the SAME field-kind vocabulary as document data', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: validQuoteData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service, mailService } = buildService();
      const action = service.runAction('company-1', 'quote', 'send', {
        documentId: 'doc-1',
        data: validQuoteData,
        params: {}, // missing the required "recipient"
      });

      await expect(action).rejects.toThrow(/Invalid document data/);
      expect(mailService.sendMail).not.toHaveBeenCalled();
    });

    it('sends the email and marks the document "sent" once params are valid', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: validQuoteData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sent',
        data: validQuoteData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service, mailService } = buildService();
      const result = await service.runAction('company-1', 'quote', 'send', {
        documentId: 'doc-1',
        data: validQuoteData,
        params: { recipient: 'client@example.com' },
      });

      expect(result.changed).toBe(true);
      expect(result.document).toMatchObject({ id: 'doc-1', status: 'sent' });
      expect(result.message).toMatch(/client@example\.com/);
      expect(mailService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'client@example.com', subject: expect.stringContaining('doc-1') }),
      );
      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'quote',
        'doc-1',
        'sent',
        validQuoteData,
      );
    });

    it("pre-fills the recipient param default from the document's client", async () => {
      const { service, clientsService } = buildService();
      clientsService.getClientById.mockResolvedValue({
        id: 'client-1',
        contactEmail: 'client-1@example.com',
      });

      const defaults = await service.resolveActionParamsDefaults('company-1', 'quote', 'send', {
        data: validQuoteData,
      });

      expect(defaults).toEqual({ recipient: 'client-1@example.com' });
      expect(clientsService.getClientById).toHaveBeenCalledWith('company-1', 'client-1');
    });

    it('returns no defaults when the client has no contact email on file', async () => {
      const { service, clientsService } = buildService();
      clientsService.getClientById.mockResolvedValue({ id: 'client-1', contactEmail: null });

      const defaults = await service.resolveActionParamsDefaults('company-1', 'quote', 'send', {
        data: validQuoteData,
      });

      expect(defaults).toEqual({});
    });

    it('returns {} (not an error) for an action with no registered defaults resolver', async () => {
      const { service } = buildService();
      const defaults = await service.resolveActionParamsDefaults('company-1', 'quote', 'save-draft', {
        data: validQuoteData,
      });
      expect(defaults).toEqual({});
    });
  });

  describe('extensibility — a third party attaches "duplicate" to the quote type', () => {
    it('appears in the type descriptor served to the frontend, alongside the native actions', () => {
      const descriptor = buildService().service.getType('quote');
      expect(descriptor.actions.map((a) => a.id)).toEqual(
        expect.arrayContaining(['save-draft', 'send', 'convert-to-invoice', 'duplicate']),
      );
    });

    it('runs through the exact same runAction path as a native action', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: validQuoteData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-2',
        typeId: 'quote',
        status: 'draft',
        data: validQuoteData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const result = await service.runAction('company-1', 'quote', 'duplicate', {
        documentId: 'doc-1',
        data: validQuoteData,
      });

      expect(result.changed).toBe(true);
      expect(result.document).toMatchObject({ id: 'doc-2', status: 'draft' });
      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'quote',
        undefined,
        'draft',
        validQuoteData,
      );
    });

    it('still gets refused by the 409 status check — extension actions are not a shortcut', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'archived',
        data: validQuoteData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      await expect(
        service.runAction('company-1', 'quote', 'duplicate', { documentId: 'doc-1', data: validQuoteData }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('a plugin declaring an id that collides with a native action fails loudly at boot', () => {
      const typeRegistry = new DocumentTypeRegistry();
      typeRegistry.register(buildQuoteDescriptor());
      const fieldKindRegistry = new FieldKindRegistry();
      registerCoreFieldKinds(fieldKindRegistry);
      const actionRegistry = new ActionRegistry();
      registerQuoteActions(actionRegistry, {
        clientsService: { getClientById: jest.fn() } as never,
        mailService: { sendMail: jest.fn() } as never,
      });
      const actionExtensionRegistry = new ActionExtensionRegistry();
      // "send" already exists natively on the quote descriptor — this is the misconfiguration.
      actionExtensionRegistry.register('quote', { id: 'send', label: 'Rogue send', availableWhen: 'always' });
      const referenceRegistry = new EntityReferenceRegistry();

      const service = new DocumentsService(
        typeRegistry,
        fieldKindRegistry,
        actionRegistry,
        actionExtensionRegistry,
        referenceRegistry,
      );

      expect(() => service.onModuleInit()).toThrow(/declared both natively and as an extension/);
    });
  });
});
