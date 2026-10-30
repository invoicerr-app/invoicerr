import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TEMP_WORKSPACE_MAX_AGE_MS,
  createTempWorkspace,
  resetTempWorkspaceSweepForTests,
  sweepStaleTempWorkspaces,
  tempWorkspaceRoot,
} from './temp-workspace';

let root: string;
const originalEnv = process.env.DOCUMENTS_TEMP_DIR;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'invoicerr-temp-workspace-spec-'));
  process.env.DOCUMENTS_TEMP_DIR = root;
  resetTempWorkspaceSweepForTests();
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.DOCUMENTS_TEMP_DIR;
  else process.env.DOCUMENTS_TEMP_DIR = originalEnv;
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

describe('tempWorkspaceRoot', () => {
  it('uses DOCUMENTS_TEMP_DIR when set', () => {
    expect(tempWorkspaceRoot({ DOCUMENTS_TEMP_DIR: '/data/tmp' })).toBe('/data/tmp');
  });

  it('falls back to a dedicated directory under the OS temp root', () => {
    expect(tempWorkspaceRoot({})).toBe(join(tmpdir(), 'invoicerr-temp'));
  });

  it('ignores an empty or whitespace-only value rather than writing to the filesystem root', () => {
    expect(tempWorkspaceRoot({ DOCUMENTS_TEMP_DIR: '   ' })).toBe(join(tmpdir(), 'invoicerr-temp'));
  });
});

describe('createTempWorkspace', () => {
  it('creates a private directory under the configured root', async () => {
    const dir = await createTempWorkspace('export');

    expect(dir.startsWith(root)).toBe(true);
    expect((await stat(dir)).isDirectory()).toBe(true);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it('gives every unit of work its own directory', async () => {
    const first = await createTempWorkspace('export');
    const second = await createTempWorkspace('export');

    expect(first).not.toBe(second);
  });
});

describe('sweepStaleTempWorkspaces', () => {
  it('is a no-op when the root does not exist yet', async () => {
    expect(await sweepStaleTempWorkspaces({ root: join(root, 'missing') })).toEqual({ removed: 0 });
  });

  it('removes a directory left behind by a crashed process and keeps a fresh one', async () => {
    const stale = join(root, 'invoicerr-billing-export-stale');
    const fresh = join(root, 'invoicerr-billing-export-fresh');
    await mkdir(stale);
    await mkdir(fresh);
    await writeFile(join(stale, 'export.zip'), 'a whole company');

    const old = new Date(Date.now() - TEMP_WORKSPACE_MAX_AGE_MS - 60_000);
    await utimes(stale, old, old);

    expect(await sweepStaleTempWorkspaces({ root })).toEqual({ removed: 1 });
    await expect(stat(stale)).rejects.toThrow();
    expect((await stat(fresh)).isDirectory()).toBe(true);
  });

  it('never touches a regular file at the root', async () => {
    const file = join(root, 'invoicerr-temp-workspace.spec.ts');
    await writeFile(file, 'not ours');
    const old = new Date(Date.now() - TEMP_WORKSPACE_MAX_AGE_MS - 60_000);
    await utimes(file, old, old);

    expect(await sweepStaleTempWorkspaces({ root })).toEqual({ removed: 0 });
    expect((await stat(file)).isFile()).toBe(true);
  });

  it('runs once per process on the first workspace creation', async () => {
    const stale = join(root, 'invoicerr-stale-from-before');
    await mkdir(stale);
    const old = new Date(Date.now() - TEMP_WORKSPACE_MAX_AGE_MS - 60_000);
    await utimes(stale, old, old);

    await createTempWorkspace('export');
    // The sweep is deliberately not awaited by its caller, so poll rather than assume it already ran.
    await vi.waitFor(async () => {
      await expect(stat(stale)).rejects.toThrow();
    });
  });
});
