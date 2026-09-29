/**
 * Issue #340 - REAL Postgres proof for `DocumentImportService`, the one write path that ever lands a
 * document on "imported" (see that file's own header for why it never goes through
 * `ActionRegistry`/`runAction`). Same "a mock proves nothing about the real constraints" posture
 * `numbering/kept-series-year-guard.atomic.spec.ts` documents for its own claim - this module writes
 * real Postgres rows, real files on disk, and its own guarantees (retention, no counter consumed, the
 * KSeF authority-event bridge for a later Polish correction) are exactly the kind of thing a mock
 * would let a bug hide behind.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import prisma from '@/prisma/prisma.service';

import { AttachmentsService } from '../attachments/attachments.service';
import { CountryFieldOverlayCatalog } from '../country-fields/registry';
import { FieldKindRegistry, registerCoreFieldKinds } from '../descriptors/field-kinds';
import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { DocumentImportService, DocumentImportValidationError } from './document-import.service';
import { ImportDocumentInput } from './document-import.types';

function buildService(): DocumentImportService {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());
  typeRegistry.register(buildCreditNoteDescriptor());
  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);
  return new DocumentImportService(
    typeRegistry,
    fieldKindRegistry,
    new CountryFieldOverlayCatalog(),
    new AttachmentsService(),
  );
}

async function createTestCompany(countryCode: string, country: string): Promise<string> {
  const company = await prisma.company.create({
    data: {
      name: `Import test ${countryCode} ${Date.now()}-${Math.random()}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 Test Street',
      postalCode: '00000',
      city: 'Testville',
      country,
      countryCode,
      phone: '+10000000000',
      email: `import-340-${Date.now()}-${Math.random()}@example.com`,
    },
    select: { id: true },
  });
  return company.id;
}

const ORIGINAL_PDF_BYTES = Buffer.from('%PDF-1.4 fake original invoice bytes', 'utf-8');

async function uploadOriginal(service: DocumentImportService, companyId: string) {
  const attachments = new AttachmentsService();
  return attachments.upload(companyId, {
    fileName: 'original.pdf',
    mime: 'application/pdf',
    bytes: ORIGINAL_PDF_BYTES,
  });
}

function invoiceInput(companyId: string, overrides: Partial<ImportDocumentInput> = {}): ImportDocumentInput {
  return {
    companyId,
    typeId: 'invoice',
    data: {
      client: 'not-a-real-client-id',
      issueDate: '2024-03-15',
      dueDate: '2024-04-15',
      currency: 'EUR',
      lines: [
        { description: 'Historical service', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: '20' },
      ],
    },
    originalNumber: 'OLD-2024-0042',
    transmissionEvidence: {},
    originalFile: { fileRef: 'missing', fileName: 'original.pdf', mime: 'application/pdf' },
    ...overrides,
  };
}

describe('DocumentImportService (issue #340, real Postgres)', () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

  let archiveDir: string;
  let inboundDir: string;
  const originalArchiveDir = process.env.DOCUMENTS_ARCHIVE_DIR;
  const originalInboundDir = process.env.DOCUMENTS_INBOUND_DIR;
  let companyId: string;

  beforeEach(() => {
    archiveDir = mkdtempSync(join(tmpdir(), 'documents-import-archive-test-'));
    inboundDir = mkdtempSync(join(tmpdir(), 'documents-import-inbound-test-'));
    process.env.DOCUMENTS_ARCHIVE_DIR = archiveDir;
    process.env.DOCUMENTS_INBOUND_DIR = inboundDir;
  });

  afterEach(async () => {
    if (companyId) await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    rmSync(archiveDir, { recursive: true, force: true });
    rmSync(inboundDir, { recursive: true, force: true });
    if (originalArchiveDir === undefined) delete process.env.DOCUMENTS_ARCHIVE_DIR;
    else process.env.DOCUMENTS_ARCHIVE_DIR = originalArchiveDir;
    if (originalInboundDir === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalInboundDir;
  });

  it('imports a French invoice directly to "imported": number null, displayNumber verbatim, an IMPORT_ORIGINAL archive with real retention', async () => {
    companyId = await createTestCompany('FR', 'France');
    const service = buildService();
    const original = await uploadOriginal(service, companyId);

    const result = await service.importDocument(
      invoiceInput(companyId, { originalFile: { ...original, fileName: 'original.pdf' } }),
    );

    expect(result.status).toBe('imported');
    expect(result.displayNumber).toBe('OLD-2024-0042');
    expect(result.transmitted).toBe(false);

    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.status).toBe('imported');
    expect(row.number).toBeNull();
    expect(row.displayNumber).toBe('OLD-2024-0042');
    expect(row.atcud).toBeNull();
    expect(row.channelProviderId).toBeNull();
    // The lines array a later credit note's own `correctedLines` would select rows from - proves
    // `stampRowIds` really ran (row-selection/row-selection.ts), the same as an ordinary save-draft.
    const data = row.data as Record<string, unknown>;
    expect(Array.isArray(data.lines)).toBe(true);
    expect((data.lines as Record<string, unknown>[])[0]).toHaveProperty('$rowId');

    const archives = await prisma.documentArchive.findMany({ where: { documentId: result.id } });
    expect(archives).toHaveLength(1);
    expect(archives[0].kind).toBe('IMPORT_ORIGINAL');
    expect(archives[0].retentionUntil).not.toBeNull();
    // FR's own retention rule counts from issueDate (fiscal, 6y - archive/retention/data/fr.json) -
    // 2024-03-15 + 6y is at least 2030, proving the clock ran off the DOCUMENT's real historical date,
    // never off "today" (archivedAt), which is exactly the owner's own decision in #340.
    expect(archives[0].retentionUntil!.getFullYear()).toBeGreaterThanOrEqual(2030);
  });

  it('refuses with no original number, naming the field, before writing anything', async () => {
    companyId = await createTestCompany('FR', 'France');
    const service = buildService();
    const original = await uploadOriginal(service, companyId);

    await expect(
      service.importDocument(invoiceInput(companyId, { originalNumber: '  ', originalFile: original })),
    ).rejects.toThrow(DocumentImportValidationError);

    const count = await prisma.documentInstance.count({ where: { companyId } });
    expect(count).toBe(0);
  });

  it('refuses with no original file', async () => {
    companyId = await createTestCompany('FR', 'France');
    const service = buildService();

    await expect(
      service.importDocument(
        invoiceInput(companyId, {
          originalFile: { fileRef: '', fileName: '', mime: '' },
        }),
      ),
    ).rejects.toThrow(DocumentImportValidationError);
  });

  it('refuses invalid business data (missing client), naming the field - the same check save-draft runs', async () => {
    companyId = await createTestCompany('FR', 'France');
    const service = buildService();
    const original = await uploadOriginal(service, companyId);

    const input = invoiceInput(companyId, { originalFile: original });
    delete (input.data as Record<string, unknown>).client;

    await expect(service.importDocument(input)).rejects.toMatchObject({
      response: { errors: expect.arrayContaining([expect.objectContaining({ key: 'client' })]) },
    });
  });

  it('a Polish invoice with a declared KSeF number: channelProviderId set to "ksef" and a KSeF authority event journaled, so a later KOR cites it', async () => {
    companyId = await createTestCompany('PL', 'Poland');
    const service = buildService();
    const original = await uploadOriginal(service, companyId);

    const result = await service.importDocument(
      invoiceInput(companyId, {
        originalFile: original,
        originalNumber: 'FV/2024/07/0012',
        transmissionEvidence: { ksefNumber: '1234567890-20240315-ABCDEF123456-A1' },
      }),
    );

    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.channelProviderId).toBe('ksef');

    const events = await prisma.documentAuthorityEvent.findMany({ where: { documentId: result.id } });
    expect(events).toHaveLength(1);
    expect(events[0].providerId).toBe('ksef');
    expect((events[0].rawPayload as Record<string, unknown>).ksefNumber).toBe(
      '1234567890-20240315-ABCDEF123456-A1',
    );
  });

  it('a Portuguese invoice with a declared ATCUD: frozen straight onto the atcud column, normalized with the "ATCUD:" prefix', async () => {
    companyId = await createTestCompany('PT', 'Portugal');
    const service = buildService();
    const original = await uploadOriginal(service, companyId);

    const result = await service.importDocument(
      invoiceInput(companyId, {
        originalFile: original,
        originalNumber: 'FT B/9',
        transmissionEvidence: { atcud: 'XYZ12345-9' },
      }),
    );

    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.atcud).toBe('ATCUD:XYZ12345-9');
  });

  it('reports transmitted=true once any transmission evidence is declared', async () => {
    companyId = await createTestCompany('IT', 'Italy');
    const service = buildService();
    const original = await uploadOriginal(service, companyId);

    const result = await service.importDocument(
      invoiceInput(companyId, {
        originalFile: original,
        transmissionEvidence: { sdiId: 'IT-SDI-99887766' },
      }),
    );

    expect(result.transmitted).toBe(true);
  });

  it('imports a FREE credit note (no invoice reference, a reason required) to "imported"', async () => {
    companyId = await createTestCompany('FR', 'France');
    const service = buildService();
    const original = await uploadOriginal(service, companyId);

    const result = await service.importDocument({
      companyId,
      typeId: 'credit-note',
      data: {
        issueDate: '2024-02-01',
        currency: 'EUR',
        reason: 'Commercial gesture, recorded by the previous tool.',
        lines: [{ description: 'Discount', quantity: 1, unitPrice: 50, vatRate: '20' }],
      },
      originalNumber: 'AV-2024-0007',
      transmissionEvidence: {},
      originalFile: original,
    });

    expect(result.typeId).toBe('credit-note');
    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.status).toBe('imported');
    expect(row.number).toBeNull();
  });
});

/**
 * "imported" has no outgoing transition, BY THE LIFECYCLE, not by a bespoke guard someone could
 * forget to add elsewhere - the exact property #340 requires ("refused by the lifecycle, not only
 * hidden"). `availableWhen` (descriptors/lifecycle.ts#transitionsAvailableWhen) is the SAME gate
 * `documents.service.ts#runAction` checks before ever calling a handler (a 409 the instant current
 * status is not in it) - proving "imported" is absent from every action's own `availableWhen` proves
 * "send"/"cancel"/"save-draft" are refused from it, directly from the descriptor `runAction` itself
 * reads, with no need to boot the whole service.
 */
describe('"imported" has no outgoing transition (issue #340) - invoice.descriptor.ts / credit-note.descriptor.ts', () => {
  it('invoice: "save-draft", "send" and "cancel" are never available from "imported"', () => {
    const descriptor = buildInvoiceDescriptor();
    expect(descriptor.statuses?.map((s) => s.id)).toContain('imported');
    for (const actionId of ['save-draft', 'send', 'cancel']) {
      const action = descriptor.actions.find((a) => a.id === actionId)!;
      expect(action.availableWhen).not.toContain('imported');
    }
  });

  it('invoice: "record-payment" IS available from "imported" (the owner\'s own decision)', () => {
    const descriptor = buildInvoiceDescriptor();
    const recordPayment = descriptor.actions.find((a) => a.id === 'record-payment')!;
    expect(recordPayment.availableWhen).toContain('imported');
  });

  it('invoice: "download-xml" and "share-link" (a regenerated file/link) are NOT available from "imported"', () => {
    const descriptor = buildInvoiceDescriptor();
    for (const actionId of ['download-xml', 'share-link']) {
      const action = descriptor.actions.find((a) => a.id === actionId)!;
      expect(action.availableWhen).not.toContain('imported');
    }
  });

  it('credit note: "save-draft" and "send" are never available from "imported"', () => {
    const descriptor = buildCreditNoteDescriptor();
    expect(descriptor.statuses?.map((s) => s.id)).toContain('imported');
    for (const actionId of ['save-draft', 'send']) {
      const action = descriptor.actions.find((a) => a.id === actionId)!;
      expect(action.availableWhen).not.toContain('imported');
    }
  });
});
