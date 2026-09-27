/**
 * Issue #490, "PDF download serves the last sent version of a document edited back to draft".
 *
 * Real Postgres and real archive storage (a throwaway directory): the quote goes through the real
 * two-phase send (`actions/async-send.ts`), whose delivery is archived by the real
 * `archive/archive-on-send.ts`; it is edited through the real save-draft (`performSaveDraft`, with
 * the `fromStatuses` `runAction` hands it); and the PDF is asked of the real
 * `DocumentsService.renderInstancePdf`, the method every PDF consumer goes through. Only two things
 * are faked: the email delivery (`deliver` returns bytes naming the data they were "rendered" from)
 * and the Chromium render (`renderDocumentInstance`, which returns bytes naming the data it was given
 * and a marker saying they were rendered, so "served from the archive" and "rendered fresh" can never
 * be confused).
 *
 * The test that matters is the first one: send, edit back to draft, download, get the edited content.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { vi, type Mock } from 'vitest';

import { DocumentArchiveKind } from '../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { runAsyncSendAction } from './actions/async-send';
import { performSaveDraft } from './actions/generic-actions';
import { hashDocumentData } from './archive/document-data-hash';
import { createDocumentArchive } from './archive/persistence';
import { ContributionRegistry } from './contributions/contribution-registry';
import { allowedFromStatuses } from './descriptors/lifecycle';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { DocumentsService } from './documents.service';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as renderInstancePdf from './rendering/render-instance-pdf';
import { TransportRegistry } from './transports/transport-registry';

vi.mock('./rendering/render-instance-pdf');

const QUOTE_V1 = {
  client: 'client-1',
  issueDate: '2026-09-27',
  currency: 'EUR',
  lines: [{ description: 'Original line', quantity: 1, unitPrice: 100, vatRate: '20' }],
};
const QUOTE_V2 = {
  ...QUOTE_V1,
  lines: [{ description: 'Edited line', quantity: 1, unitPrice: 900, vatRate: '20' }],
};

const SAVE_DRAFT_FROM = (() => {
  const descriptor = buildQuoteDescriptor();
  const saveDraft = descriptor.actions.find((a) => a.id === 'save-draft')!;
  return allowedFromStatuses(descriptor, saveDraft)!;
})();

function buildService(): DocumentsService {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());
  typeRegistry.register(buildInvoiceDescriptor());
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

describe('issue #490 - renderInstancePdf serves the archived PDF only while it is still the right one', () => {
  let companyId: string;
  let archiveDir: string;
  const previousArchiveDir = process.env.DOCUMENTS_ARCHIVE_DIR;
  const previousArchiveStorage = process.env.ARCHIVE_STORAGE;
  const service = buildService();

  /** What the fake email delivery "attached": bytes naming the data they came from. */
  const deliver = vi.fn(async ({ document }: { document: { data: unknown } }) => ({
    message: 'Quote emailed.',
    artifacts: [
      {
        role: 'pdf' as const,
        mime: 'application/pdf' as const,
        bytes: new Uint8Array(Buffer.from(`%PDF-archived ${JSON.stringify(document.data)}`)),
      },
    ],
  }));

  beforeAll(async () => {
    archiveDir = mkdtempSync(join(tmpdir(), 'invoicerr-490-'));
    process.env.DOCUMENTS_ARCHIVE_DIR = archiveDir;
    delete process.env.ARCHIVE_STORAGE;
    const company = await prisma.company.create({
      data: {
        name: 'PDF Currency Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'Nowhereland', // deliberately unresolvable - keeps country-policy out of the way
        phone: '+33100000000',
        email: `pdf-currency-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.documentArchive.deleteMany({ where: { companyId } });
    await prisma.documentInstance.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    rmSync(archiveDir, { recursive: true, force: true });
    if (previousArchiveDir === undefined) delete process.env.DOCUMENTS_ARCHIVE_DIR;
    else process.env.DOCUMENTS_ARCHIVE_DIR = previousArchiveDir;
    if (previousArchiveStorage !== undefined) process.env.ARCHIVE_STORAGE = previousArchiveStorage;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (renderInstancePdf.renderDocumentInstance as Mock).mockImplementation(
      async (_deps: unknown, _companyId: string, _descriptor: unknown, instance: { data: unknown }) => ({
        pdf: Buffer.from(`%PDF-rendered ${JSON.stringify(instance.data)}`),
      }),
    );
  });

  /** The real two-phase send: phase 1 (draft -> sending, numbered), then the worker's replay. */
  async function send(documentId: string, data: Record<string, unknown>): Promise<void> {
    const input = {
      companyId,
      typeId: 'quote',
      documentId,
      data,
      params: { recipient: 'client@example.com' },
      queueDispatcher: { enqueueAction: vi.fn(async () => undefined) },
      deliver: deliver as never,
      numberOnEnqueue: true,
    };
    await runAsyncSendAction(input);
    await runAsyncSendAction(input);
    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.status).toBe('sent');
  }

  async function createSentQuote(): Promise<string> {
    const created = await performSaveDraft(companyId, 'quote', undefined, QUOTE_V1);
    const documentId = created.document!.id;
    await send(documentId, QUOTE_V1);
    return documentId;
  }

  async function download(typeId: string, documentId: string): Promise<string> {
    return (await service.renderInstancePdf(companyId, typeId, documentId)).toString();
  }

  it('send, edit back to draft, download: the edited content, rendered fresh, not the last sent PDF', async () => {
    const documentId = await createSentQuote();
    // Unedited sent quote: the archive, no render.
    expect(await download('quote', documentId)).toContain('%PDF-archived');
    expect(renderInstancePdf.renderDocumentInstance).not.toHaveBeenCalled();

    await performSaveDraft(companyId, 'quote', documentId, QUOTE_V2, undefined, SAVE_DRAFT_FROM);
    const edited = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
    expect(edited.status).toBe('draft');

    const pdf = await download('quote', documentId);
    expect(pdf).toContain('%PDF-rendered');
    expect(pdf).toContain('Edited line');
    expect(pdf).not.toContain('Original line');
  });

  it('the archive records the hash of the data its PDF was rendered from, the same hash an e-signature binds to', async () => {
    const documentId = await createSentQuote();
    const [archive] = await prisma.documentArchive.findMany({
      where: { companyId, documentId, kind: DocumentArchiveKind.DELIVERY },
    });
    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
    expect(archive.documentDataHash).toBe(hashDocumentData(row.data));
  });

  it('sent again after the edit: the new archive is served again, holding the edited content', async () => {
    const documentId = await createSentQuote();
    await performSaveDraft(companyId, 'quote', documentId, QUOTE_V2, undefined, SAVE_DRAFT_FROM);
    await send(documentId, QUOTE_V2);

    const pdf = await download('quote', documentId);
    expect(pdf).toContain('%PDF-archived');
    expect(pdf).toContain('Edited line');
    expect(renderInstancePdf.renderDocumentInstance).not.toHaveBeenCalled();
  });

  it('a data change that keeps the quote "sent" is rendered fresh too: the rule is the data, not the status', async () => {
    const documentId = await createSentQuote();
    await prisma.documentInstance.update({ where: { id: documentId }, data: { data: QUOTE_V2 } });

    const pdf = await download('quote', documentId);
    expect(pdf).toContain('%PDF-rendered');
    expect(pdf).toContain('Edited line');
  });

  it('a quote archive written before the hash existed (NULL) proves nothing about its data: rendered fresh', async () => {
    const documentId = await createSentQuote();
    await prisma.documentArchive.updateMany({
      where: { companyId, documentId },
      data: { documentDataHash: null },
    });

    expect(await download('quote', documentId)).toContain('%PDF-rendered');
  });

  it('an ISSUED document keeps being served from its archive, even when its data no longer matches: it is the legal copy', async () => {
    // A signed quote ("signed" is locked by the quote's own save-draft) whose data moved after the
    // archive was written.
    const quoteId = await createSentQuote();
    await prisma.documentInstance.update({
      where: { id: quoteId },
      data: { status: 'signed', data: QUOTE_V2 },
    });
    const quotePdf = await download('quote', quoteId);
    expect(quotePdf).toContain('%PDF-archived');
    expect(quotePdf).toContain('Original line');

    // A sent invoice whose archive predates the hash (NULL): served all the same.
    const invoice = await performSaveDraft(companyId, 'invoice', undefined, QUOTE_V1);
    const invoiceId = invoice.document!.id;
    await createDocumentArchive({
      companyId,
      documentId: invoiceId,
      artifacts: [
        { role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array(Buffer.from('%PDF-archived invoice')) },
      ],
    });
    await prisma.documentInstance.update({ where: { id: invoiceId }, data: { status: 'sent' } });
    expect(await download('invoice', invoiceId)).toBe('%PDF-archived invoice');
    expect(renderInstancePdf.renderDocumentInstance).not.toHaveBeenCalled();
  });
});
