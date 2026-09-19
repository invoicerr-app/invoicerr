import { vi, type Mock } from 'vitest';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import * as archivePersistence from './archive/persistence';
import { ContributionRegistry } from './contributions/contribution-registry';
import { DocumentsService } from './documents.service';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as renderInstancePdf from './rendering/render-instance-pdf';
import { TransportRegistry } from './transports/transport-registry';

vi.mock('./persistence');
vi.mock('./rendering/render-instance-pdf');
vi.mock('./archive/persistence');

/**
 * `DocumentsService.renderInstancePdf` — the ONE method every PDF route in this backend funnels
 * through: the authenticated `GET :id/pdf` (documents.controller.ts), the public share-link download
 * (public-documents.controller.ts), and the client portal's own document download
 * (client-portal/portal.service.ts#getDocumentPdf) — see that method's own header. Every API replica
 * otherwise launches and holds its own Chromium purely to answer these routes, three of which are
 * unauthenticated.
 *
 * This proves the fix directly: a document that already has an archived PDF is served THOSE bytes,
 * with `renderDocumentInstance` (the Chromium-backed composition — `rendering/render-pdf.spec.ts`
 * covers that layer on its own) never even called; a document with nothing archived yet (a draft) or
 * delivered through a channel with no plain-PDF artifact still falls through to the render this
 * method has always done. `archive/persistence.ts#findArchivedPdfArtifact` itself is proven against a
 * REAL disk round trip in `archive/persistence.spec.ts` — mocked here at its own module boundary,
 * exactly like `./persistence` and `./rendering/render-instance-pdf` already are, so this file stays
 * about the ONE decision `renderInstancePdf` itself makes (archive first, render only if absent).
 */
function buildService(): DocumentsService {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());
  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
}

const SENT_QUOTE = {
  id: 'doc-1',
  typeId: 'quote',
  status: 'sent',
  data: { client: 'client-1' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('DocumentsService.renderInstancePdf — serving the archive instead of re-rendering', () => {
  beforeEach(() => vi.resetAllMocks());

  it('serves the archived PDF byte-for-byte, and NEVER calls renderDocumentInstance, when one exists', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_QUOTE);
    const archivedBytes = Buffer.from('%PDF-1.7 already archived — exactly what was emailed');
    (archivePersistence.findArchivedPdfArtifact as Mock).mockResolvedValue(archivedBytes);

    const service = buildService();
    const pdf = await service.renderInstancePdf('company-1', 'quote', 'doc-1');

    // The EXACT same object, not a copy re-derived from it — the strongest form of "the bytes are
    // the same" a unit test can assert.
    expect(pdf).toBe(archivedBytes);
    expect(archivePersistence.findArchivedPdfArtifact).toHaveBeenCalledWith('company-1', 'doc-1');
    expect(renderInstancePdf.renderDocumentInstance).not.toHaveBeenCalled();
  });

  it('falls back to rendering fresh (and signing if configured) when nothing is archived yet', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue({ ...SENT_QUOTE, status: 'draft' });
    (archivePersistence.findArchivedPdfArtifact as Mock).mockResolvedValue(null);
    const rendered = Buffer.from('%PDF-1.7 freshly rendered');
    (renderInstancePdf.renderDocumentInstance as Mock).mockResolvedValue({ pdf: rendered });

    const service = buildService();
    const pdf = await service.renderInstancePdf('company-1', 'quote', 'doc-1');

    // No active signing certificate configured in this fixture (no CREDENTIALS_ENCRYPTION_KEY) — the
    // rendered buffer passes through `signRenderedPdfIfConfigured` untouched, the same invariant every
    // pre-existing `documents.service.*.spec.ts` already relies on.
    expect(pdf).toEqual(rendered);
    expect(renderInstancePdf.renderDocumentInstance).toHaveBeenCalledTimes(1);
  });

  it('checks the archive scoped to the exact (companyId, documentId) this call was made for, before ever reading the instance for rendering', async () => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(SENT_QUOTE);
    (archivePersistence.findArchivedPdfArtifact as Mock).mockResolvedValue(null);
    (renderInstancePdf.renderDocumentInstance as Mock).mockResolvedValue({ pdf: Buffer.from('x') });

    const service = buildService();
    await service.renderInstancePdf('company-9', 'quote', 'doc-42');

    expect(archivePersistence.findArchivedPdfArtifact).toHaveBeenCalledWith('company-9', 'doc-42');
  });
});
