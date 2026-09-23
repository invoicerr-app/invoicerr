import { vi, type Mock } from 'vitest';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConflictException } from '@nestjs/common';

import * as persistence from '../../persistence';
import * as supplierReconciliation from '../supplier-reconciliation';
import { receivedDocumentExtractorRegistry } from './extractor';
import { ReceivedInvoiceFileMissingError, runReceivedInvoiceOcrJob } from './run-ocr-job';
import { persistInboundFile } from '../storage';

vi.mock('../../persistence');
vi.mock('../supplier-reconciliation');

const listAllDocuments = persistence.listAllDocuments as Mock;
const upsertDocument = persistence.upsertDocument as Mock;
const reconcileSupplierClient = supplierReconciliation.reconcileSupplierClient as Mock;

const STUB_ID = 'stub-run-ocr-job';
const extract = vi.fn();

beforeAll(() => {
  // ONE stub, registered once — the registry has no `unregister`, see `extractor.ts`'s own header.
  receivedDocumentExtractorRegistry.register({
    id: STUB_ID,
    supports: (mime: string) => mime === 'application/pdf',
    extract,
  });
});

/** Real-enough-to-pass-validation, not a genuinely parseable PDF — see
 *  `received-invoices.service.spec.ts#fakeScannedPdfBytes`'s own header for the identical reasoning. */
function fakeScannedPdfBytes(): Buffer {
  return Buffer.from('%PDF-1.4\na scanned page, no embedded XML at all');
}

describe('runReceivedInvoiceOcrJob', () => {
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_INBOUND_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'run-ocr-job-test-'));
    process.env.DOCUMENTS_INBOUND_DIR = dir;
    extract.mockReset();
    listAllDocuments.mockReset();
    upsertDocument.mockReset();
    reconcileSupplierClient.mockReset();
    reconcileSupplierClient.mockResolvedValue({ outcome: 'unmatched', reason: 'no-criteria' });
    listAllDocuments.mockResolvedValue([]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalEnv;
    vi.resetAllMocks();
  });

  it('throws a NAMED error when the file is no longer on disk — the job fails, never a silent empty result', async () => {
    await expect(
      runReceivedInvoiceOcrJob({
        companyId: 'company-1',
        fileRef: 'a'.repeat(64),
        fileName: 'never-stored.pdf',
        mime: 'application/pdf',
      }),
    ).rejects.toThrow(ReceivedInvoiceFileMissingError);
  });

  it('returns the extraction/supplierMatch/ocr shape once OCR succeeds', async () => {
    const fileRef = 'b'.repeat(64);
    await persistInboundFile('company-1', fileRef, 'application/pdf', fakeScannedPdfBytes());
    extract.mockResolvedValue({ fields: { supplier: 'OCR Co', netAmount: 100 } });

    const result = await runReceivedInvoiceOcrJob({
      companyId: 'company-1',
      fileRef,
      fileName: 'scan.pdf',
      mime: 'application/pdf',
    });

    expect(result).toEqual({
      extraction: { syntax: 'OCR', fields: { supplier: 'OCR Co', netAmount: 100 } },
      supplierMatch: { outcome: 'unmatched', reason: 'no-criteria' },
      ocr: { outcome: 'extracted', extractorId: STUB_ID },
    });
  });

  it('adds supplierClient to the returned fields when reconcileSupplierClient matched', async () => {
    const fileRef = 'c'.repeat(64);
    await persistInboundFile('company-1', fileRef, 'application/pdf', fakeScannedPdfBytes());
    extract.mockResolvedValue({ fields: { supplier: 'OCR Co', supplierVatId: 'FR123' } });
    reconcileSupplierClient.mockResolvedValue({ outcome: 'matched', clientId: 'client-1', matchedBy: 'vat' });

    const result = await runReceivedInvoiceOcrJob({
      companyId: 'company-1',
      fileRef,
      fileName: 'scan.pdf',
      mime: 'application/pdf',
    });

    expect(result.extraction.fields.supplierClient).toBe('client-1');
    expect(reconcileSupplierClient).toHaveBeenCalledWith('company-1', {
      vatId: 'FR123',
      supplierName: 'OCR Co',
    });
  });

  describe('backfill', () => {
    it('does nothing when no received-invoice record matches this fileRef yet — the ordinary case', async () => {
      const fileRef = 'd'.repeat(64);
      await persistInboundFile('company-1', fileRef, 'application/pdf', fakeScannedPdfBytes());
      extract.mockResolvedValue({ fields: { supplier: 'OCR Co' } });
      listAllDocuments.mockResolvedValue([]);
      const events = { publish: vi.fn() };

      await runReceivedInvoiceOcrJob({
        companyId: 'company-1',
        fileRef,
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        events,
      });

      expect(upsertDocument).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('fills ONLY the keys the human left empty, and never overwrites a real value already saved', async () => {
      const fileRef = 'e'.repeat(64);
      await persistInboundFile('company-1', fileRef, 'application/pdf', fakeScannedPdfBytes());
      extract.mockResolvedValue({
        fields: {
          supplier: 'OCR Supplier',
          supplierVatId: 'FR60708090801',
          issueDate: '2026-09-01',
          currency: 'USD',
          lines: [{ description: 'OCR line' }],
        },
      });
      listAllDocuments.mockResolvedValue([
        {
          id: 'ri-1',
          typeId: 'received-invoice',
          status: 'received',
          data: {
            fileRef,
            supplier: 'Human Typed Supplier', // a real value — must survive
            supplierVatId: '', // empty string — fillable
            issueDate: null, // null — fillable
            currency: 'EUR', // a real value — must survive
            lines: [], // an empty array — fillable
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const events = { publish: vi.fn() };

      await runReceivedInvoiceOcrJob({
        companyId: 'company-1',
        fileRef,
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        events,
      });

      expect(upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'received-invoice',
        'ri-1',
        'received',
        {
          fileRef,
          supplier: 'Human Typed Supplier',
          supplierVatId: 'FR60708090801',
          issueDate: '2026-09-01',
          currency: 'EUR',
          lines: [{ description: 'OCR line' }],
        },
        ['received'],
      );
      expect(events.publish).toHaveBeenCalledWith('company-1', {
        documentId: 'ri-1',
        typeId: 'received-invoice',
        kind: 'ocr-backfilled',
      });
    });

    it('writes and publishes nothing when every OCR-read field is already filled with a real value', async () => {
      const fileRef = 'f'.repeat(64);
      await persistInboundFile('company-1', fileRef, 'application/pdf', fakeScannedPdfBytes());
      extract.mockResolvedValue({ fields: { supplier: 'OCR Supplier' } });
      listAllDocuments.mockResolvedValue([
        {
          id: 'ri-1',
          typeId: 'received-invoice',
          status: 'received',
          data: { fileRef, supplier: 'Human Typed Supplier' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const events = { publish: vi.fn() };

      await runReceivedInvoiceOcrJob({
        companyId: 'company-1',
        fileRef,
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        events,
      });

      expect(upsertDocument).not.toHaveBeenCalled();
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('never throws when the record concurrently moved to a different status — the human wins, not a job failure', async () => {
      const fileRef = 'a1'.repeat(32);
      await persistInboundFile('company-1', fileRef, 'application/pdf', fakeScannedPdfBytes());
      extract.mockResolvedValue({ fields: { supplier: 'OCR Supplier' } });
      listAllDocuments.mockResolvedValue([
        {
          id: 'ri-1',
          typeId: 'received-invoice',
          status: 'received',
          data: { fileRef },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      upsertDocument.mockRejectedValue(new ConflictException('another request already changed it'));

      await expect(
        runReceivedInvoiceOcrJob({
          companyId: 'company-1',
          fileRef,
          fileName: 'scan.pdf',
          mime: 'application/pdf',
        }),
      ).resolves.toEqual(expect.objectContaining({ ocr: { outcome: 'extracted', extractorId: STUB_ID } }));
    });
  });
});
