import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { listInboundBackupSources } from './inbound-source';

async function drain(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

describe('backup/sources/inbound-source', () => {
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_INBOUND_DIR;
  const originalInboundS3Bucket = process.env.INBOUND_S3_BUCKET;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'documents-inbound-backup-test-'));
    process.env.DOCUMENTS_INBOUND_DIR = dir;
    // Every test in this file exercises the LOCAL half only — a prior file in the same worker must
    // never leak an `INBOUND_S3_BUCKET` in here and make this suite attempt a real network call.
    delete process.env.INBOUND_S3_BUCKET;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalEnv;
    if (originalInboundS3Bucket === undefined) delete process.env.INBOUND_S3_BUCKET;
    else process.env.INBOUND_S3_BUCKET = originalInboundS3Bucket;
  });

  it('returns an empty list when the root does not exist yet — never throws', async () => {
    rmSync(dir, { recursive: true, force: true });
    expect(await listInboundBackupSources()).toEqual([]);
  });

  it('walks every company subdirectory and prefixes each key with "inbound/"', async () => {
    mkdirSync(join(dir, 'company-1'), { recursive: true });
    writeFileSync(join(dir, 'company-1', 'aaa.pdf'), 'hello');
    mkdirSync(join(dir, 'company-2'), { recursive: true });
    writeFileSync(join(dir, 'company-2', 'bbb.png'), 'world!');

    const files = (await listInboundBackupSources()).sort((a, b) => a.key.localeCompare(b.key));

    expect(files.map((f) => f.key)).toEqual(['inbound/company-1/aaa.pdf', 'inbound/company-2/bbb.png']);
    expect(files[0].size).toBe(5);
    expect(files[1].size).toBe(6);
  });

  it('read() streams the exact bytes on disk — never a whole-file Buffer', async () => {
    mkdirSync(join(dir, 'company-1'), { recursive: true });
    writeFileSync(join(dir, 'company-1', 'aaa.pdf'), 'exact bytes');

    const [file] = await listInboundBackupSources();
    await expect(file.read().then(drain)).resolves.toEqual(Buffer.from('exact bytes'));
  });

  // `INBOUND_S3_BUCKET` unset (the default) must never attempt a network call at all — the S3 half
  // short-circuits to `[]` before ever building a client, same reasoning `archive-source.ts`'s own
  // spec relies on for its own local-only default case.
  it('never touches S3 when INBOUND_S3_BUCKET is unset', async () => {
    expect(await listInboundBackupSources()).toEqual([]);
  });
});
