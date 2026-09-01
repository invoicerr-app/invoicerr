import { ConflictException } from '@nestjs/common';

import { ActionExtensionRegistry } from '../../documents/actions/action-extensions';
import { ActionRegistry } from '../../documents/actions/action-registry';
import { ContributionRegistry } from '../../documents/contributions/contribution-registry';
import * as countryPolicy from '../../documents/country-policy/country-policy';
import { DocumentsService } from '../../documents/documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from '../../documents/descriptors/field-kinds';
import { buildInvoiceDescriptor } from '../../documents/descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from '../../documents/descriptors/type-registry';
import * as persistence from '../../documents/persistence';
import { EntityReferenceRegistry } from '../../documents/references/reference-registry';
import * as shareLinkPersistence from '../../documents/share-links/share-link.persistence';
import { ShareLinksService } from '../../documents/share-links/share-links.service';
import { TransportRegistry } from '../../documents/transports/transport-registry';
import { getDocumentPdfLinkTool } from './get-document-pdf-link.tool';
import { ToolContext } from './types';

jest.mock('../../documents/persistence');
jest.mock('../../documents/country-policy/country-policy');
jest.mock('../../documents/share-links/share-link.persistence');

/**
 * Proves `get_document_pdf_link` reaches the REAL `ShareLinksService.create` — the same instance the
 * REST endpoint (`POST /documents/:id/share-link`) uses — so a draft is refused with the exact named
 * reason the app's own "share link" button would show, never a looser MCP-only check. Only the
 * Prisma boundaries (`documents/persistence.ts` for the document itself,
 * `share-links/share-link.persistence.ts` for the token row) and the country-policy DECISION are
 * mocked, same discipline `run-document-action.tool.spec.ts` already holds.
 */
function buildServices() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const documentsService = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(), // "share-link" is never registered here — see share-links.service.ts's header.
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );

  const shareLinksService = new ShareLinksService(documentsService);
  return { documentsService, shareLinksService };
}

function buildContext(
  shareLinksService: ShareLinksService,
  scopes: string[] | null = ['invoices:read'],
): ToolContext {
  return {
    companyId: 'company-1',
    scopes,
    baseUrl: 'http://localhost:4000',
    services: {
      documentsService: {} as never,
      shareLinksService,
      clientsService: {} as never,
      articlesService: {} as never,
    },
  };
}

describe('getDocumentPdfLinkTool — the real gates, via ShareLinksService.create', () => {
  afterEach(() => jest.resetAllMocks());

  it("refuses the call BEFORE ever reaching ShareLinksService when this API key's scopes do not cover the type", async () => {
    const { shareLinksService } = buildServices();
    const ctx = buildContext(shareLinksService, ['clients:read']); // no invoices:read/write at all

    await expect(
      getDocumentPdfLinkTool.handler(ctx, { typeId: 'invoice', documentId: 'doc-1' }),
    ).rejects.toThrow(/invoices:read/);
  });

  it('refuses a DRAFT by saying so — a draft has no number and no legal existence to share yet', async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { shareLinksService } = buildServices();
    const ctx = buildContext(shareLinksService);

    const call = getDocumentPdfLinkTool.handler(ctx, { typeId: 'invoice', documentId: 'doc-1' });

    await expect(call).rejects.toBeInstanceOf(ConflictException);
    await expect(call).rejects.toThrow(/status "draft"/);
    await expect(call).rejects.toThrow(/no number and no legal existence/);
    expect(shareLinkPersistence.createShareLinkToken).not.toHaveBeenCalled();
  });

  it("a numbered invoice gets a real, absolute download URL built from the CALLING request's own origin", async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'invoice',
      status: 'sent',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (shareLinkPersistence.createShareLinkToken as jest.Mock).mockResolvedValue({
      id: 'token-row-1',
      tokenHash: 'irrelevant',
      typeId: 'invoice',
      documentId: 'doc-1',
      companyId: 'company-1',
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date(),
      revokedAt: null,
    });
    const { shareLinksService } = buildServices();
    const ctx = buildContext(shareLinksService);

    const result = await getDocumentPdfLinkTool.handler(ctx, { typeId: 'invoice', documentId: 'doc-1' });

    expect(shareLinkPersistence.createShareLinkToken).toHaveBeenCalled();
    // The token itself is a real, randomly-generated secret (share-link-token.ts is never mocked
    // here) — only its SHAPE (ctx.baseUrl + the service's own API-relative path) is asserted.
    expect(result.structuredContent).toEqual({
      typeId: 'invoice',
      documentId: 'doc-1',
      downloadUrl: expect.stringMatching(/^http:\/\/localhost:4000\/api\/public\/documents\/[0-9a-f]+\/pdf$/),
      expiresAt: '2026-02-01T00:00:00.000Z',
    });
  });
});
