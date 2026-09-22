/**
 * The duplicate-upload refusal, over a company whose received-invoice inbox crosses the read cap.
 *
 * Not a sum, but the same rule and the same money: the check compared a file hash against the 500
 * most recently touched received invoices, in memory. Past that, re-uploading a file already on
 * record was accepted as new — the same supplier invoice recorded twice, and eventually PAID twice,
 * with the duplicate check reporting nothing at all. The hash now goes into the query, so the whole
 * inbox is checked however large it is; the fixture puts the already-recorded file at the OLD end,
 * which is what the capped read discarded first.
 *
 * The refusal happens before a single byte is stored, so only the upload validation ahead of it has
 * to be real here; storage is stubbed so the one case that DOES get past the check writes nothing to
 * disk.
 */
import { createHash } from 'node:crypto';

import { ConflictException } from '@nestjs/common';
import { vi } from 'vitest';

import { documentInstanceRow, seedDocumentInstances } from '../__tests__/fake-document-instance-table';

vi.mock('@/prisma/prisma.service', async () => {
  const module = await import('../__tests__/fake-document-instance-table');
  return { default: module.fakePrismaClient, prisma: module.fakePrismaClient };
});
vi.mock('./storage', () => ({
  persistInboundFile: vi.fn().mockResolvedValue(undefined),
  readInboundFile: vi.fn(),
}));

const { ReceivedInvoicesService } = await import('./received-invoices.service');

/** Past the 500-row cap this check used to apply. */
const INBOX_SIZE = 600;

/** A minimal but genuinely PDF-shaped payload — `validateInboundFile` checks the real magic bytes,
 *  never the declared mime alone. */
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(256, 0x20)]);
const PDF_HASH = createHash('sha256').update(PDF_BYTES).digest('hex');

function service() {
  return new ReceivedInvoicesService();
}

beforeEach(() => {
  seedDocumentInstances([
    // The invoice this file was already received as — the LEAST recently touched row in the inbox.
    documentInstanceRow({
      id: 'already-received',
      typeId: 'received-invoice',
      status: 'received',
      updatedAt: new Date(Date.UTC(2020, 0, 1)),
      data: { fileRef: PDF_HASH, fileName: 'supplier.pdf' },
    }),
    ...Array.from({ length: INBOX_SIZE }, (_, index) =>
      documentInstanceRow({
        id: `recv-${String(index).padStart(5, '0')}`,
        typeId: 'received-invoice',
        status: 'received',
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
        data: { fileRef: `other-hash-${index}`, fileName: `other-${index}.pdf` },
      }),
    ),
  ]);
});

describe('ReceivedInvoicesService.upload past the read cap', () => {
  it('still refuses a file already on record, however long ago it was received', async () => {
    await expect(
      service().upload('company-1', {
        fileName: 'supplier.pdf',
        mime: 'application/pdf',
        bytes: PDF_BYTES,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('names the document the file was already received as', async () => {
    await expect(
      service().upload('company-1', {
        fileName: 'supplier.pdf',
        mime: 'application/pdf',
        bytes: PDF_BYTES,
      }),
    ).rejects.toThrow(/already-received/);
  });

  it("never matches another company's copy of the same file", async () => {
    seedDocumentInstances([
      documentInstanceRow({
        id: 'theirs',
        companyId: 'company-2',
        typeId: 'received-invoice',
        data: { fileRef: PDF_HASH },
      }),
    ]);

    // No duplicate to find for THIS company, so the upload goes through and hands back its preview.
    const preview = await service().upload('company-1', {
      fileName: 'supplier.pdf',
      mime: 'application/pdf',
      bytes: PDF_BYTES,
    });

    expect(preview.fileRef).toBe(PDF_HASH);
  });
});
