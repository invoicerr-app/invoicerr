import { existsSync, readFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import JSZip = require('jszip');
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REQUIRES_DOCUMENT_TYPE_SCOPE_KEY, REQUIRES_SCOPE_KEY } from '@/utils/scope-check';

import { MAX_VENDOR_UPLOAD_BYTES } from './vendor-export-workbook';
import { VendorImportController } from './vendor-import.controller';
import { VendorImportService } from './vendor-import.service';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)));
const CLIENTS = fixture('tiime-clients.xlsx');
const INVOICES = fixture('tiime-invoices.xlsx');
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

async function zipOf(files: Record<string, Uint8Array | string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/** The real controller behind a real HTTP server, so multer's limits and the 413 are exercised. */
let app: INestApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [VendorImportController],
    providers: [VendorImportService],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  // The global auth guard sets the active company in the app; a header stands in for it here.
  app.use((req: { headers: Record<string, string>; companyId?: string }, _res: unknown, next: () => void) => {
    if (req.headers['x-test-company']) req.companyId = req.headers['x-test-company'];
    next();
  });
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/imports/vendor`;
});

afterAll(async () => {
  await app?.close();
});

async function upload(path: string, bytes: Uint8Array | undefined, name = 'export.zip', company = 'c1') {
  const form = new FormData();
  if (bytes) form.append('file', new Blob([Buffer.from(bytes)]), name);
  const headers: Record<string, string> = company ? { 'x-test-company': company } : {};
  const response = await fetch(`${base}/${path}`, { method: 'POST', body: form, headers });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('POST /imports/vendor/.../file-preview', () => {
  it('recognises a Tiime client workbook uploaded as XLSX', async () => {
    const { status, body } = await upload('clients/file-preview', CLIENTS, 'clients.xlsx');
    expect(status).toBe(201);
    const [workbook] = body.workbooks as { detected: boolean; profileId: string; rows: string[][] }[];
    expect(workbook.detected).toBe(true);
    expect(workbook.profileId).toBe('tiime-clients');
    expect(workbook.rows.length).toBeGreaterThan(0);
  });

  it('recognises the invoice workbook of a Tiime ZIP and skips its PDFs', async () => {
    const archive = await zipOf({ 'export/factures.xlsx': INVOICES, 'export/Facture-1.pdf': '%PDF-1.4' });
    const { status, body } = await upload('documents/invoice/file-preview', archive);
    expect(status).toBe(201);
    expect(body.ignoredPdfCount).toBe(1);
    expect(body.workbooks).toMatchObject([
      { fileName: 'export/factures.xlsx', detected: true, profileId: 'tiime-invoices' },
    ]);
  });

  it('answers detected: false for a workbook no profile recognises', async () => {
    const { status, body } = await upload('documents/invoice/file-preview', CLIENTS, 'clients.xlsx');
    expect(status).toBe(201);
    expect(body.workbooks).toMatchObject([{ detected: false }]);
  });

  it('keeps the existing import rights and the active company', async () => {
    const reflector = new Reflector();
    const proto = VendorImportController.prototype;
    expect(reflector.get(REQUIRES_SCOPE_KEY, proto.previewClientsFile)).toEqual(['clients:write']);
    expect(reflector.get(REQUIRES_DOCUMENT_TYPE_SCOPE_KEY, proto.previewDocumentsFile)).toBe('write');
    expect((await upload('clients/file-preview', CLIENTS, 'clients.xlsx', '')).status).toBe(403);
  });

  it('refuses a missing file, and any document type but invoice', async () => {
    expect((await upload('clients/file-preview', undefined)).status).toBe(400);
    expect((await upload('documents/quote/file-preview', INVOICES, 'q.xlsx')).status).toBe(400);
  });

  describe('a hostile upload', () => {
    it('answers 413 for a file over the size limit', async () => {
      const big = new Uint8Array(MAX_VENDOR_UPLOAD_BYTES + 1);
      big.set([0x50, 0x4b, 0x03, 0x04]);
      expect((await upload('clients/file-preview', big)).status).toBe(413);
    });

    it('refuses a file renamed .zip that is not one, by its bytes', async () => {
      const { status, body } = await upload('clients/file-preview', new TextEncoder().encode('%PDF-1.4 x'));
      expect(status).toBe(400);
      expect(body.message).toContain('not an XLSX workbook or a ZIP archive');
    });

    it('refuses a ZIP bomb before inflating it in full', async () => {
      // 64 MB of zeros deflate to well under 100 KB; the reader stops past its 25 MB per entry cap.
      const bomb = await zipOf({ 'bomb.xlsx': new Uint8Array(64 * 1024 * 1024) });
      expect(bomb.length).toBeLessThan(200_000);
      const started = performance.now();
      const { status, body } = await upload('clients/file-preview', bomb);
      expect(status).toBe(400);
      expect(body.message).toContain('too large');
      expect(performance.now() - started).toBeLessThan(10_000);
    });

    it('refuses an archive nested in the archive', async () => {
      const inner = await zipOf({ 'clients.xlsx': CLIENTS });
      const { status, body } = await upload('clients/file-preview', await zipOf({ 'inner.zip': inner }));
      expect(status).toBe(400);
      expect(body.message).toContain('another archive');
    });

    it('refuses an archive with too many entries', async () => {
      const files: Record<string, string> = { 'clients.xlsx': '' };
      for (let i = 0; i < 5_001; i++) files[`f${i}.txt`] = '';
      const { status, body } = await upload('clients/file-preview', await zipOf(files));
      expect(status).toBe(400);
      expect(body.message).toContain('more than 5000 files');
    });

    it('treats ../ and absolute entry names as labels, never as paths', async () => {
      const names = ['../../vendor-upload-escape.xlsx', '/tmp/vendor-upload-absolute.xlsx'];
      const archive = await zipOf({ [names[0]]: CLIENTS, [names[1]]: CLIENTS });
      const { status, body } = await upload('clients/file-preview', archive);
      expect(status).toBe(201);
      expect((body.workbooks as { detected: boolean }[]).every((w) => w.detected)).toBe(true);
      for (const where of [process.cwd(), __dirname, tmpdir()]) {
        expect(existsSync(resolve(where, names[0]))).toBe(false);
      }
      expect(existsSync(names[1])).toBe(false);
    });

    it('refuses a workbook declaring an external entity (XXE) or nested entities', async () => {
      const sheet = `<worksheet xmlns="${MAIN_NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&x;</t></is></c></row></sheetData></worksheet>`;
      const workbook = (dtd: string) =>
        zipOf({
          'xl/workbook.xml': `<workbook xmlns="${MAIN_NS}"><sheets><sheet name="S" sheetId="1"/></sheets></workbook>`,
          'xl/worksheets/sheet1.xml': `<?xml version="1.0"?>${dtd}${sheet}`,
        });
      const xxe = await workbook('<!DOCTYPE worksheet [<!ENTITY x SYSTEM "file:///etc/passwd">]>');
      const lol = await workbook(
        `<!DOCTYPE worksheet [<!ENTITY a "lol">${Array.from(
          { length: 9 },
          (_, i) =>
            `<!ENTITY ${String.fromCharCode(98 + i)} "${`&${String.fromCharCode(97 + i)};`.repeat(10)}">`,
        ).join('')}<!ENTITY x "&j;">]>`,
      );
      for (const bytes of [xxe, lol]) {
        const { status, body } = await upload('clients/file-preview', bytes, 'w.xlsx');
        expect(status).toBe(400);
        expect(body.message).toContain('declares a DOCTYPE');
        expect(JSON.stringify(body)).not.toMatch(/root:/);
      }
    });
  });
});
