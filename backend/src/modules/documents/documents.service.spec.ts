import { NotImplementedException } from '@nestjs/common';

import { ActionRegistry } from './actions/action-registry';
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
 * kinds, real quote action registration) directly into `new DocumentsService(...)`, the way every
 * other test in this codebase constructs a service — no Nest TestingModule needed. Only the Prisma
 * boundary (persistence.ts) is mocked, so this never touches a real database.
 */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const actionRegistry = new ActionRegistry();
  registerQuoteActions(actionRegistry);
  // "send" is NOT registered here, on purpose — see quote-actions.ts.

  const referenceRegistry = new EntityReferenceRegistry();

  return new DocumentsService(typeRegistry, fieldKindRegistry, actionRegistry, referenceRegistry);
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
    expect(buildService().listTypes()).toEqual([{ id: 'quote', label: 'Quote' }]);
  });

  it('rejects an unknown document type instead of returning something empty', () => {
    expect(() => buildService().getType('invoice')).toThrow(/Unknown document type "invoice"/);
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

    const result = await buildService().runAction('company-1', 'quote', 'save-draft', {
      data: validQuoteData,
    });

    expect(result).toMatchObject({ id: 'doc-1', status: 'draft' });
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'quote',
      undefined,
      'draft',
      validQuoteData,
    );
  });

  it('blocks "save-draft" on invalid data before ever touching persistence', async () => {
    await expect(buildService().runAction('company-1', 'quote', 'save-draft', { data: {} })).rejects.toThrow(
      /Invalid document data/,
    );
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  // The behaviour the task calls "must be BLOCKED and say so": "send" is a real, declared action on
  // the real quote descriptor, and genuinely has no implementation registered (quote-actions.ts).
  // This is not a synthetic double standing in for the mechanism — it IS the mechanism, exercised
  // through the exact wiring documents.module.ts uses.
  it('blocks "send" — declared on the descriptor, no implementation registered — with a clear 501', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'draft',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const service = buildService();
    const action = service.runAction('company-1', 'quote', 'send', {
      documentId: 'doc-1',
      data: validQuoteData,
    });

    await expect(action).rejects.toBeInstanceOf(NotImplementedException);
    await expect(action).rejects.toThrow(/no registered implementation/);
  });

  it('blocks "send" before the document is even saved — it has no status to match "draft" yet', async () => {
    await expect(
      buildService().runAction('company-1', 'quote', 'send', { data: validQuoteData }),
    ).rejects.toThrow(/not available before the document has been saved/);
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
  });

  it('rejects an action nobody declared on this type at all', async () => {
    await expect(
      buildService().runAction('company-1', 'quote', 'archive', { data: validQuoteData }),
    ).rejects.toThrow(/has no action "archive"/);
  });
});
