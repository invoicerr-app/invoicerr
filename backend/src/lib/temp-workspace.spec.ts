import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TEMP_WORKSPACE_MARKER,
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
  /** The shape `createTempWorkspace` leaves behind, without triggering its once-per-process sweep. */
  const markedWorkspace = async (name: string): Promise<string> => {
    const dir = join(root, name);
    await mkdir(dir, { mode: 0o700 });
    await writeFile(join(dir, TEMP_WORKSPACE_MARKER), '');
    return dir;
  };

  const agePastSweep = async (path: string): Promise<void> => {
    const old = new Date(Date.now() - TEMP_WORKSPACE_MAX_AGE_MS - 60_000);
    await utimes(path, old, old);
  };

  it('is a no-op when the root does not exist yet', async () => {
    expect(await sweepStaleTempWorkspaces({ root: join(root, 'missing') })).toEqual({ removed: 0 });
  });

  it('removes a directory left behind by a crashed process and keeps a fresh one', async () => {
    const stale = await markedWorkspace('invoicerr-billing-export-stale');
    const fresh = await markedWorkspace('invoicerr-billing-export-fresh');
    await writeFile(join(stale, 'export.zip'), 'a whole company');
    await agePastSweep(stale);

    expect(await sweepStaleTempWorkspaces({ root })).toEqual({ removed: 1 });
    await expect(stat(stale)).rejects.toThrow();
    expect((await stat(fresh)).isDirectory()).toBe(true);
  });

  it('leaves a foreign directory alone, however old, because it carries no marker', async () => {
    // The review case: the sweep used to delete ANY directory older than 24 h under the root, so an
    // operator's own scratch directory (or another tool's cache) was destroyed. Same prefix here on
    // purpose: only the marker decides.
    const foreign = join(root, 'invoicerr-billing-export-foreign');
    await mkdir(foreign);
    await writeFile(join(foreign, 'notes.txt'), 'not ours');
    await agePastSweep(foreign);

    expect(await sweepStaleTempWorkspaces({ root })).toEqual({ removed: 0 });
    expect((await stat(foreign)).isDirectory()).toBe(true);
    expect(await readdir(foreign)).toEqual(['notes.txt']);
  });

  it('never touches a regular file at the root', async () => {
    const file = join(root, 'invoicerr-temp-workspace.spec.ts');
    await writeFile(file, 'not ours');
    await agePastSweep(file);

    expect(await sweepStaleTempWorkspaces({ root })).toEqual({ removed: 0 });
    expect((await stat(file)).isFile()).toBe(true);
  });

  it('refuses a symlinked root instead of sweeping whatever it points at', async () => {
    const target = await mkdtemp(join(tmpdir(), 'invoicerr-temp-target-'));
    const linked = join(root, 'linked-root');
    await symlink(target, linked, 'dir');
    const inside = join(target, 'invoicerr-billing-export-stale');
    await mkdir(inside);
    await writeFile(join(inside, TEMP_WORKSPACE_MARKER), '');
    await agePastSweep(inside);

    expect(await sweepStaleTempWorkspaces({ root: linked })).toEqual({ removed: 0 });
    expect((await stat(inside)).isDirectory()).toBe(true);

    await rm(target, { recursive: true, force: true });
  });

  it('runs once per process on the first workspace creation', async () => {
    const stale = await markedWorkspace('invoicerr-stale-from-before');
    await agePastSweep(stale);

    await createTempWorkspace('export');
    // The sweep is deliberately not awaited by its caller, so poll rather than assume it already ran.
    await vi.waitFor(async () => {
      await expect(stat(stale)).rejects.toThrow();
    });
  });
});

describe('root safety', () => {
  it('refuses a symlinked root when creating a workspace', async () => {
    // `mkdir({ recursive: true })` accepts a pre-existing symlink silently, so the old code wrote
    // every workspace behind the link instead of under the root the operator configured.
    const target = await mkdtemp(join(tmpdir(), 'invoicerr-temp-target-'));
    const linked = join(root, 'linked-root');
    await symlink(target, linked, 'dir');

    await expect(createTempWorkspace('export', { DOCUMENTS_TEMP_DIR: linked })).rejects.toThrow(
      /symbolic link/i,
    );
    expect(await readdir(target)).toEqual([]);

    await rm(target, { recursive: true, force: true });
  });

  it('refuses a root that is not a directory', async () => {
    const file = join(root, 'not-a-directory');
    await writeFile(file, '');

    await expect(createTempWorkspace('export', { DOCUMENTS_TEMP_DIR: file })).rejects.toThrow(
      /not a directory/i,
    );
  });

  it('refuses a root another local user could read', async () => {
    // A 0755 root exposes every company export written under it; fail closed and name the fix.
    await chmod(root, 0o755);

    await expect(createTempWorkspace('export', { DOCUMENTS_TEMP_DIR: root })).rejects.toThrow(/must be 0700/);

    await chmod(root, 0o700);
  });

  it('accepts a root it created itself at 0700', async () => {
    const dir = await createTempWorkspace('export');
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, TEMP_WORKSPACE_MARKER))).isFile()).toBe(true);
  });
});
