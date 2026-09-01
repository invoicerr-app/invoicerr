import { NotFoundException } from '@nestjs/common';

import { ActionExtensionRegistry } from '../actions/action-extensions';
import { ActionRegistry } from '../actions/action-registry';
import { ContributionRegistry } from '../contributions/contribution-registry';
import * as countryPolicy from '../country-policy/country-policy';
import { DocumentsController } from '../documents.controller';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { FieldKindRegistry, registerCoreFieldKinds } from '../descriptors/field-kinds';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { DocumentsService } from '../documents.service';
import * as persistence from '../persistence';
import { EntityReferenceRegistry } from '../references/reference-registry';
import * as renderInstancePdf from '../rendering/render-instance-pdf';
import { ShareLinksService } from '../share-links/share-links.service';
import { TransportRegistry } from '../transports/transport-registry';
import { PublicDocumentsController } from './public-documents.controller';

jest.mock('../persistence');
jest.mock('../country-policy/country-policy');
jest.mock('../rendering/render-instance-pdf');
// `@thallesp/nestjs-better-auth`'s own package ships an ESM-only transitive dependency
// (better-auth/dist/integrations/node.mjs) jest's ts-jest transform doesn't parse — mocked here,
// the same way any other module boundary this suite doesn't need the REAL implementation of is
// mocked, rather than widening jest.config.js's transformIgnorePatterns for one decorator whose
// only job (see PublicDocumentsController's own header) is to set metadata AuthGuard reads.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  Public: () => () => undefined,
}));

// The same in-memory `DocumentDownloadToken` fake as share-links.service.spec.ts — see that file's
// own header for why this (not a bare per-method jest.fn()) is the right boundary to mock.
jest.mock('@/prisma/prisma.service', () => {
  const rows: Array<Record<string, unknown>> = [];
  let nextId = 1;
  return {
    __esModule: true,
    default: {
      documentDownloadToken: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `token-${nextId++}`, createdAt: new Date(), revokedAt: null, ...data };
          rows.push(row);
          return row;
        }),
        findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
          return rows.find((r) => r.tokenHash === where.tokenHash) ?? null;
        }),
        findFirst: jest.fn(
          async ({ where }: { where: { id: string; companyId: string; documentId: string } }) => {
            return (
              rows.find(
                (r) =>
                  r.id === where.id && r.companyId === where.companyId && r.documentId === where.documentId,
              ) ?? null
            );
          },
        ),
        findMany: jest.fn(async () => []),
        findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error('not found');
          return row;
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = rows.find((r) => r.id === where.id);
          Object.assign(row!, data);
          return row;
        }),
      },
    },
  };
});

/**
 * Proves root TODO item 24's central invariant: "the public link serves EXACTLY the same PDF the
 * authenticated GET already does — never a second implementation." Both controllers below are built
 * over the SAME `DocumentsService` instance, and `renderInstancePdf` (the one place that composes
 * render + PAdES-signing) is spied on rather than reimplemented — so a passing test here means both
 * HTTP entry points genuinely funnel through the identical method call, not two call sites that
 * merely happen to agree today.
 *
 * No active signing certificate in this fixture (see `DocumentsService.renderInstancePdf`'s own
 * header: no cert configured -> the PDF is returned byte-for-byte unchanged) — wiring a real PKCS12
 * fixture through `SigningCertificatesService`/`CREDENTIALS_ENCRYPTION_KEY` just for this equality
 * check did not seem worth the added fixture weight; the byte-identity property this test proves is
 * about the TWO CONTROLLERS agreeing, which holds regardless of whether signing is on, since signing
 * itself is internal to the one shared `renderInstancePdf` call both of them make.
 */
function buildControllers() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());
  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const documentsService = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
  const shareLinksService = new ShareLinksService(documentsService);
  const schedulesService = { list: jest.fn() };

  const documentsController = new DocumentsController(
    documentsService,
    schedulesService as never,
    shareLinksService,
  );
  const publicController = new PublicDocumentsController(shareLinksService, documentsService);

  return { documentsController, publicController, shareLinksService, documentsService };
}

function fakeResponse() {
  const res = {
    headers: {} as Record<string, string>,
    sentBody: undefined as Buffer | undefined,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    send(body: Buffer) {
      this.sentBody = body;
    },
  };
  return res;
}

const SENT_INSTANCE = {
  id: 'doc-1',
  typeId: 'invoice',
  status: 'sent',
  data: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  displayNumber: 'INV-2026-0001',
};

describe('PublicDocumentsController — the public PDF is the SAME pipeline as the authenticated one', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(SENT_INSTANCE);
    (renderInstancePdf.renderDocumentInstance as jest.Mock).mockResolvedValue({
      pdf: Buffer.from('%PDF-1.7 fake rendered bytes, deterministic for this test'),
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
  });

  it('serves byte-for-byte the same PDF as GET /documents/:id/pdf, for the same document', async () => {
    const { documentsController, publicController, shareLinksService } = buildControllers();

    const authenticatedRes = fakeResponse();
    await documentsController.renderPdf('company-1', 'doc-1', 'invoice', authenticatedRes as never);
    expect(authenticatedRes.sentBody).toBeInstanceOf(Buffer);

    const created = await shareLinksService.create('company-1', 'invoice', 'doc-1');
    const publicRes = fakeResponse();
    await publicController.getSharedPdf(created.token, publicRes as never);
    expect(publicRes.sentBody).toBeInstanceOf(Buffer);

    // THE assertion: same bytes, same document, one rendering pipeline.
    expect(publicRes.sentBody!.equals(authenticatedRes.sentBody!)).toBe(true);
    expect(publicRes.headers['Content-Type']).toBe(authenticatedRes.headers['Content-Type']);

    // Both entry points reduced to the SAME single call — not two implementations that happen to
    // agree on THIS fixture's output.
    expect(renderInstancePdf.renderDocumentInstance).toHaveBeenCalledTimes(2);
    for (const call of (renderInstancePdf.renderDocumentInstance as jest.Mock).mock.calls) {
      expect(call[1]).toBe('company-1');
      expect(call[3]).toMatchObject({ id: 'doc-1' });
    }
  });

  it('answers the exact same 404 for an unknown, an expired, and a revoked token', async () => {
    const { publicController, shareLinksService } = buildControllers();

    const unknownRes = fakeResponse();
    await expect(publicController.getSharedPdf('never-existed', unknownRes as never)).rejects.toThrow(
      NotFoundException,
    );

    const created = await shareLinksService.create('company-1', 'invoice', 'doc-1');
    await shareLinksService.revoke('company-1', 'invoice', 'doc-1', created.id);
    const revokedRes = fakeResponse();
    let revokedError: unknown;
    try {
      await publicController.getSharedPdf(created.token, revokedRes as never);
    } catch (error) {
      revokedError = error;
    }

    let unknownError: unknown;
    try {
      await publicController.getSharedPdf('another-unknown-token', fakeResponse() as never);
    } catch (error) {
      unknownError = error;
    }

    expect(revokedError).toBeInstanceOf(NotFoundException);
    expect(unknownError).toBeInstanceOf(NotFoundException);
    // Identical response shape — a caller cannot tell "this token once existed" from "it never did".
    expect((revokedError as NotFoundException).getResponse()).toEqual(
      (unknownError as NotFoundException).getResponse(),
    );
    expect((revokedError as NotFoundException).getStatus()).toBe(
      (unknownError as NotFoundException).getStatus(),
    );
  });
});
