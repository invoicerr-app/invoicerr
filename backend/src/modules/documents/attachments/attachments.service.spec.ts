import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';

import { computeArtifactHash } from '../archive/hashing';
import { AttachmentsService, MAX_ATTACHMENT_BYTES } from './attachments.service';

describe('AttachmentsService', () => {
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_INBOUND_DIR;
  let service: AttachmentsService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'documents-attachments-test-'));
    process.env.DOCUMENTS_INBOUND_DIR = dir;
    service = new AttachmentsService();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalEnv;
  });

  describe('upload', () => {
    it('stores an allowed file and returns its SHA-256 as fileRef', async () => {
      const base64 = Buffer.from('%PDF-fake receipt', 'utf-8').toString('base64');
      const expectedHash = computeArtifactHash(Buffer.from('%PDF-fake receipt', 'utf-8'));

      const ref = await service.upload('company-1', {
        fileName: 'receipt.pdf',
        mime: 'application/pdf',
        base64,
      });

      expect(ref).toEqual({ fileRef: expectedHash, fileName: 'receipt.pdf', mime: 'application/pdf' });
    });

    it('accepts a photo (image/jpeg) — the primary "photo of a receipt" case', async () => {
      const base64 = Buffer.from('fake-jpeg-bytes', 'utf-8').toString('base64');
      const ref = await service.upload('company-1', {
        fileName: 'receipt.jpg',
        mime: 'image/jpeg',
        base64,
      });
      expect(ref.mime).toBe('image/jpeg');
    });

    it('refuses a disallowed mime type, NAMED — never silently stored', async () => {
      const base64 = Buffer.from('whatever', 'utf-8').toString('base64');
      await expect(
        service.upload('company-1', { fileName: 'script.exe', mime: 'application/x-msdownload', base64 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upload('company-1', { fileName: 'script.exe', mime: 'application/x-msdownload', base64 }),
      ).rejects.toThrow(/Unsupported file type/);
    });

    it('refuses an empty file', async () => {
      await expect(
        service.upload('company-1', { fileName: 'empty.pdf', mime: 'application/pdf', base64: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a file over MAX_ATTACHMENT_BYTES, NAMED with the actual size', async () => {
      const oversized = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1);
      const base64 = oversized.toString('base64');
      await expect(
        service.upload('company-1', { fileName: 'huge.jpg', mime: 'image/jpeg', base64 }),
      ).rejects.toThrow(PayloadTooLargeException);
      await expect(
        service.upload('company-1', { fileName: 'huge.jpg', mime: 'image/jpeg', base64 }),
      ).rejects.toThrow(new RegExp(`${MAX_ATTACHMENT_BYTES}-byte limit`));
    });

    it('accepts a file exactly AT the limit', async () => {
      const atLimit = Buffer.alloc(MAX_ATTACHMENT_BYTES, 1);
      const base64 = atLimit.toString('base64');
      const ref = await service.upload('company-1', { fileName: 'at-limit.png', mime: 'image/png', base64 });
      expect(ref.fileName).toBe('at-limit.png');
    });
  });

  describe('download', () => {
    it('reads back exactly what upload wrote, for the SAME company', async () => {
      const base64 = Buffer.from('receipt content', 'utf-8').toString('base64');
      const ref = await service.upload('company-1', {
        fileName: 'receipt.pdf',
        mime: 'application/pdf',
        base64,
      });

      const { bytes, mime } = await service.download('company-1', ref.fileRef, ref.mime);
      expect(bytes.toString('utf-8')).toBe('receipt content');
      expect(mime).toBe('application/pdf');
    });

    it('404s, named, for a fileRef never uploaded', async () => {
      await expect(service.download('company-1', 'never-uploaded', 'application/pdf')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s for a DIFFERENT company requesting the SAME fileRef — tenant scoping, never a cross-company read', async () => {
      const base64 = Buffer.from('company one only', 'utf-8').toString('base64');
      const ref = await service.upload('company-1', {
        fileName: 'receipt.pdf',
        mime: 'application/pdf',
        base64,
      });

      await expect(service.download('company-2', ref.fileRef, ref.mime)).rejects.toThrow(NotFoundException);
    });
  });
});
