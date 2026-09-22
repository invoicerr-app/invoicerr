import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

import { MAX_ATTACHMENT_BYTES } from '@/modules/documents/attachments/attachments.service';

import { logoDataUriFor, readLogo, uploadLogo } from './logo-storage';

describe('branding logo storage', () => {
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_INBOUND_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'branding-logo-test-'));
    process.env.DOCUMENTS_INBOUND_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalEnv;
  });

  describe('uploadLogo', () => {
    it('accepts a png and returns its SHA-256', async () => {
      const base64 = Buffer.from('fake-png-bytes', 'utf-8').toString('base64');
      const logoId = await uploadLogo('company-1', { mime: 'image/png', base64 });
      expect(logoId).toMatch(/^[0-9a-f]{64}$/);
    });

    it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', async (mime) => {
      const base64 = Buffer.from('bytes', 'utf-8').toString('base64');
      await expect(uploadLogo('company-1', { mime, base64 })).resolves.not.toThrow();
    });

    it('refuses a PDF — a logo is an image, never a receipt', async () => {
      const base64 = Buffer.from('%PDF-fake', 'utf-8').toString('base64');
      await expect(uploadLogo('company-1', { mime: 'application/pdf', base64 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses an empty file', async () => {
      await expect(uploadLogo('company-1', { mime: 'image/png', base64: '' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a file over MAX_ATTACHMENT_BYTES — the same ceiling every other upload in this backend uses', async () => {
      const oversized = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1).toString('base64');
      await expect(uploadLogo('company-1', { mime: 'image/png', base64: oversized })).rejects.toThrow(
        PayloadTooLargeException,
      );
    });
  });

  describe('readLogo / logoDataUriFor', () => {
    it('reads back exactly what uploadLogo wrote, mime included', async () => {
      const base64 = Buffer.from('logo content', 'utf-8').toString('base64');
      const logoId = await uploadLogo('company-1', { mime: 'image/jpeg', base64 });

      const logo = await readLogo('company-1', logoId);
      expect(logo?.bytes.toString('utf-8')).toBe('logo content');
      expect(logo?.mime).toBe('image/jpeg');
    });

    it('is null for a company that never uploaded a logo', async () => {
      expect(await readLogo('company-1', null)).toBeNull();
      expect(await readLogo('company-1', 'never-uploaded')).toBeNull();
    });

    it('is null for a DIFFERENT company requesting the same logoId — tenant scoping', async () => {
      const base64 = Buffer.from('company one only', 'utf-8').toString('base64');
      const logoId = await uploadLogo('company-1', { mime: 'image/png', base64 });

      expect(await readLogo('company-2', logoId)).toBeNull();
    });

    it('logoDataUriFor returns a data: URI carrying the right mime and base64 payload', async () => {
      const base64 = Buffer.from('logo content', 'utf-8').toString('base64');
      const logoId = await uploadLogo('company-1', { mime: 'image/webp', base64 });

      expect(await logoDataUriFor('company-1', logoId)).toBe(`data:image/webp;base64,${base64}`);
    });

    it('logoDataUriFor is null with no companyId, no logoId, or nothing on disk', async () => {
      expect(await logoDataUriFor(null, 'some-id')).toBeNull();
      expect(await logoDataUriFor('company-1', null)).toBeNull();
      expect(await logoDataUriFor('company-1', 'never-uploaded')).toBeNull();
    });
  });
});
