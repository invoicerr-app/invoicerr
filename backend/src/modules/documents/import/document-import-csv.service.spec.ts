/**
 * Issue #340 - REAL Postgres proof for the CSV bulk import: preview writes nothing, confirm imports
 * every valid row and leaves the others rejected WITHOUT rolling back the whole batch (unlike the
 * client CSV import - see `document-import-csv.service.ts`'s own header for why).
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
import { DocumentImportCsvService } from './document-import-csv.service';
import { DocumentImportService } from './document-import.service';
import { DocumentImportCsvRow } from './document-import-csv.types';
import { ImportOriginalFileRef } from './document-import.types';

function buildServices(): { csv: DocumentImportCsvService; attachments: AttachmentsService } {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());
  typeRegistry.register(buildCreditNoteDescriptor());
  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);
  const attachments = new AttachmentsService();
  const importService = new DocumentImportService(
    typeRegistry,
    fieldKindRegistry,
    new CountryFieldOverlayCatalog(),
    attachments,
  );
  return { csv: new DocumentImportCsvService(importService), attachments };
}

async function createTestCompany(): Promise<string> {
  const company = await prisma.company.create({
    data: {
      name: `Import CSV test ${Date.now()}-${Math.random()}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 Test Street',
      postalCode: '00000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `import-csv-340-${Date.now()}-${Math.random()}@example.com`,
    },
    select: { id: true },
  });
  return company.id;
}

describe('DocumentImportCsvService (issue #340, real Postgres)', () => {
  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

  let archiveDir: string;
  let inboundDir: string;
  const originalArchiveDir = process.env.DOCUMENTS_ARCHIVE_DIR;
  const originalInboundDir = process.env.DOCUMENTS_INBOUND_DIR;
  let companyId: string;

  beforeEach(() => {
    archiveDir = mkdtempSync(join(tmpdir(), 'documents-import-csv-archive-test-'));
    inboundDir = mkdtempSync(join(tmpdir(), 'documents-import-csv-inbound-test-'));
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

  it('preview: a valid row is "valid" and writes nothing; a row with no matching file is "rejected"', async () => {
    companyId = await createTestCompany();
    const { csv, attachments } = buildServices();
    const file = await attachments.upload(companyId, {
      fileName: 'a.pdf',
      mime: 'application/pdf',
      bytes: Buffer.from('%PDF fake', 'utf-8'),
    });

    const rows: DocumentImportCsvRow[] = [
      {
        rowNumber: 2,
        clientId: 'not-a-real-client',
        issueDate: '2024-01-10',
        currency: 'EUR',
        originalNumber: 'OLD-1',
        originalFileName: 'a.pdf',
        lineDescription: 'Consulting',
        lineQuantity: '2',
        lineUnitPrice: '150',
        lineVatRate: '20',
      },
      {
        rowNumber: 3,
        clientId: 'not-a-real-client',
        issueDate: '2024-01-11',
        currency: 'EUR',
        originalNumber: 'OLD-2',
        originalFileName: 'missing.pdf',
      },
    ];
    const files: Record<string, ImportOriginalFileRef> = { 'a.pdf': file };

    const preview = await csv.preview(companyId, { typeId: 'invoice', rows, files });

    expect(preview.summary).toEqual({ total: 2, willImport: 1, rejected: 1 });
    expect(preview.rows.find((r) => r.rowNumber === 2)?.status).toBe('valid');
    const rejected = preview.rows.find((r) => r.rowNumber === 3);
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.errors?.[0]).toMatch(/missing\.pdf/);

    const count = await prisma.documentInstance.count({ where: { companyId } });
    expect(count).toBe(0);
  });

  it('confirm: imports every valid row and counts the rest as rejected, without rolling back the batch', async () => {
    companyId = await createTestCompany();
    const { csv, attachments } = buildServices();
    const fileA = await attachments.upload(companyId, {
      fileName: 'a.pdf',
      mime: 'application/pdf',
      bytes: Buffer.from('%PDF fake A', 'utf-8'),
    });
    const fileB = await attachments.upload(companyId, {
      fileName: 'b.pdf',
      mime: 'application/pdf',
      bytes: Buffer.from('%PDF fake B', 'utf-8'),
    });

    const rows: DocumentImportCsvRow[] = [
      {
        rowNumber: 2,
        clientId: 'not-a-real-client',
        issueDate: '2024-01-10',
        currency: 'EUR',
        originalNumber: 'OLD-1',
        originalFileName: 'a.pdf',
        lineDescription: 'Consulting',
        lineQuantity: '2',
        lineUnitPrice: '150',
        lineVatRate: '20',
      },
      {
        rowNumber: 3,
        // No clientId at all - this row is invalid (invoice.client is required) and must not block
        // row 2 or row 4.
        issueDate: '2024-01-11',
        currency: 'EUR',
        originalNumber: 'OLD-2',
        originalFileName: 'b.pdf',
        lineDescription: 'Support',
        lineQuantity: '1',
        lineUnitPrice: '80',
        lineVatRate: '20',
      },
      {
        rowNumber: 4,
        clientId: 'not-a-real-client',
        issueDate: '2024-01-12',
        currency: 'EUR',
        originalNumber: 'OLD-3',
        originalFileName: 'a.pdf',
        lineDescription: 'Consulting',
        lineQuantity: '1',
        lineUnitPrice: '50',
        lineVatRate: '20',
      },
    ];
    const files: Record<string, ImportOriginalFileRef> = { 'a.pdf': fileA, 'b.pdf': fileB };

    const result = await csv.confirm(companyId, { typeId: 'invoice', rows, files });

    expect(result).toEqual({ imported: 2, rejected: 1 });
    const created = await prisma.documentInstance.findMany({
      where: { companyId },
      orderBy: { displayNumber: 'asc' },
    });
    expect(created.map((d) => d.displayNumber)).toEqual(['OLD-1', 'OLD-3']);
    for (const doc of created) expect(doc.status).toBe('imported');
  });
});
