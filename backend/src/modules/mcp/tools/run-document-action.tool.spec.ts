import { ConflictException } from '@nestjs/common';

import { ActionExtensionRegistry } from '../../documents/actions/action-extensions';
import { ActionRegistry } from '../../documents/actions/action-registry';
import { registerQuoteActions } from '../../documents/actions/quote-actions';
import { ContributionRegistry } from '../../documents/contributions/contribution-registry';
import * as countryPolicy from '../../documents/country-policy/country-policy';
import { DocumentsService } from '../../documents/documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from '../../documents/descriptors/field-kinds';
import { buildQuoteDescriptor } from '../../documents/descriptors/quote.descriptor';
import { DocumentTypeRegistry } from '../../documents/descriptors/type-registry';
import * as persistence from '../../documents/persistence';
import { EntityReferenceRegistry } from '../../documents/references/reference-registry';
import { TransportRegistry } from '../../documents/transports/transport-registry';
import { runDocumentActionTool } from './run-document-action.tool';
import { ToolContext } from './types';

jest.mock('../../documents/persistence');
jest.mock('../../documents/country-policy/country-policy');

/**
 * Proves `run_document_action` reaches the REAL `DocumentsService.runAction`, unaltered — the exact
 * building blocks `documents.service.country-policy.spec.ts` already wires (real quote descriptor,
 * real "save-draft"/"send" handlers, only the Prisma boundary and the country-policy DECISION
 * mocked) — so a country-forbidden action, a wrong-status action, and a genuine save-draft all
 * behave for this MCP tool exactly as they do for the app's own REST endpoint. The ONE thing this
 * file adds on top of that pattern is the MCP-specific scope gate (scope-mapping.ts), proven
 * separately from — and BEFORE — any of `runAction`'s own four gates.
 */
function buildDocumentsService(): DocumentsService {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const referenceRegistry = new EntityReferenceRegistry();
  const transportRegistry = new TransportRegistry();

  const actionRegistry = new ActionRegistry();
  registerQuoteActions(actionRegistry, {
    clientsService: { getClientById: jest.fn().mockResolvedValue(null) } as never,
    mailService: { sendMail: jest.fn() } as never,
    typeRegistry,
    referenceRegistry,
    queueDispatcher: { enqueueAction: jest.fn() },
  });

  const actionExtensionRegistry = new ActionExtensionRegistry();

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    actionExtensionRegistry,
    referenceRegistry,
    transportRegistry,
    new ContributionRegistry(),
  );
}

function buildContext(
  documentsService: DocumentsService,
  scopes: string[] | null = ['quotes:write'],
): ToolContext {
  return {
    companyId: 'company-1',
    scopes,
    baseUrl: 'http://localhost:4000',
    services: {
      documentsService,
      shareLinksService: {} as never,
      clientsService: {} as never,
      articlesService: {} as never,
    },
  };
}

const validQuoteData = {
  client: 'client-1',
  issueDate: '2026-01-01',
  currency: 'EUR',
  lines: [{ description: 'Widget', quantity: 2, unitPrice: 9.9 }],
};

describe('runDocumentActionTool — the real four gates, via DocumentsService.runAction', () => {
  afterEach(() => jest.resetAllMocks());

  it("refuses the call BEFORE ever reaching DocumentsService when this API key's scopes do not cover the type", async () => {
    const service = buildDocumentsService();
    const ctx = buildContext(service, ['clients:read']); // no quotes:write at all

    await expect(
      runDocumentActionTool.handler(ctx, { typeId: 'quote', actionId: 'save-draft', data: validQuoteData }),
    ).rejects.toThrow(/quotes:write/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it("surfaces the country policy's own NAMED reason verbatim — the same 403 the app's own UI would hit", async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({
      allowed: false,
      reason: 'No document action policy is declared for "ZZ".',
    });
    const service = buildDocumentsService();
    const ctx = buildContext(service);

    await expect(
      runDocumentActionTool.handler(ctx, { typeId: 'quote', actionId: 'save-draft', data: validQuoteData }),
    ).rejects.toThrow(/No document action policy is declared for "ZZ"/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it("surfaces a NAMED 409 when the action is not available for the record's current status", async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'sent', // "send" only accepts ['draft', 'send_failed'] -> 'sending'.
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = buildDocumentsService();
    const ctx = buildContext(service);

    const call = runDocumentActionTool.handler(ctx, {
      typeId: 'quote',
      actionId: 'send',
      documentId: 'doc-1',
      data: validQuoteData,
      params: { recipient: 'client@example.com' },
    });

    await expect(call).rejects.toBeInstanceOf(ConflictException);
    await expect(call).rejects.toThrow(/status "sent"/);
  });

  it('save-draft actually creates a new document instance — the real handler runs, not a stub', async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'quote',
      status: 'draft',
      data: validQuoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = buildDocumentsService();
    const ctx = buildContext(service);

    const result = await runDocumentActionTool.handler(ctx, {
      typeId: 'quote',
      actionId: 'save-draft',
      data: validQuoteData,
    });

    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'quote',
      undefined,
      'draft',
      expect.objectContaining({ client: 'client-1' }),
    );
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        document: expect.objectContaining({ id: 'doc-1', status: 'draft' }),
        changed: true,
      }),
    );
  });
});
