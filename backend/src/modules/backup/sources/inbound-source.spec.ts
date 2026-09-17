import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listInboundBackupSources } from './inbound-source';

describe('backup/sources/inbound-source', () => {
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_INBOUND_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'documents-inbound-backup-test-'));
    process.env.DOCUMENTS_INBOUND_DIR = dir;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalEnv;
  });

  it('returns an empty list when the root does not exist yet — never throws', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(listInboundBackupSources()).toEqual([]);
  });

  it('walks every company subdirectory and prefixes each key with "inbound/"', () => {
    mkdirSync(join(dir, 'company-1'), { recursive: true });
    writeFileSync(join(dir, 'company-1', 'aaa.pdf'), 'hello');
    mkdirSync(join(dir, 'company-2'), { recursive: true });
    writeFileSync(join(dir, 'company-2', 'bbb.png'), 'world!');

    const files = listInboundBackupSources().sort((a, b) => a.key.localeCompare(b.key));

    expect(files.map((f) => f.key)).toEqual(['inbound/company-1/aaa.pdf', 'inbound/company-2/bbb.png']);
    expect(files[0].size).toBe(5);
    expect(files[1].size).toBe(6);
  });

  it('read() returns the exact bytes on disk', async () => {
    mkdirSync(join(dir, 'company-1'), { recursive: true });
    writeFileSync(join(dir, 'company-1', 'aaa.pdf'), 'exact bytes');

    const [file] = listInboundBackupSources();
    await expect(file.read()).resolves.toEqual(Buffer.from('exact bytes'));
  });
});
