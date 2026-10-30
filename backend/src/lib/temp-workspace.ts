/**
 * Every short-lived file this process has to write (today: the streaming ZIP build behind a company
 * data export) lands under ONE directory instead of being scattered across the system temp directory.
 *
 * Two reasons. A dedicated root is what an operator can mount on a tmpfs, or delete wholesale during
 * an incident, without guessing which stray `invoicerr-*` directory holds what. And a known root is
 * what makes a stale-artifact sweep possible: a process killed between writing an export and deleting
 * it leaves a full company's data on disk, and nothing was cleaning those up before.
 *
 * The sweep is best-effort and never throws: an export must not fail because an unrelated leftover
 * directory could not be removed. Directories are `0700` and are removed as soon as their caller is
 * done with them; the age-based pass only catches the crash case.
 */
import type { Dirent } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** How long a directory may survive without its owner: long enough for a slow export on a busy
 *  instance, short enough that a crash does not leave a company's data on disk for a week. */
export const TEMP_WORKSPACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Set to move the root (a tmpfs mount, a volume with a size cap). Default: `<tmp>/invoicerr-temp`. */
export const TEMP_WORKSPACE_DIR_ENV = 'DOCUMENTS_TEMP_DIR';

export function tempWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[TEMP_WORKSPACE_DIR_ENV]?.trim();
  return configured ? configured : join(tmpdir(), 'invoicerr-temp');
}

export interface SweepOptions {
  root?: string;
  maxAgeMs?: number;
  now?: () => number;
}

/**
 * Deletes directories under the root older than `maxAgeMs`. Returns how many it removed. Never
 * throws: a missing root is not an error (nothing has been written yet), and a directory that cannot
 * be read or removed is skipped rather than aborting the caller.
 */
export async function sweepStaleTempWorkspaces(options: SweepOptions = {}): Promise<{ removed: number }> {
  const root = options.root ?? tempWorkspaceRoot();
  const maxAgeMs = options.maxAgeMs ?? TEMP_WORKSPACE_MAX_AGE_MS;
  const now = options.now ?? Date.now;

  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { removed: 0 };
  }

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    const info = await stat(path).catch(() => null);
    if (!info || now() - info.mtimeMs < maxAgeMs) continue;
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    removed++;
  }
  return { removed };
}

let sweptThisProcess = false;

/**
 * Creates a fresh `0700` directory for one unit of work. The first call in a process also runs the
 * stale-artifact sweep once, asynchronously — the caller's own directory is freshly created and thus
 * never a candidate, so the sweep cannot race what it is about to return.
 */
export async function createTempWorkspace(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const root = tempWorkspaceRoot(env);
  await mkdir(root, { recursive: true, mode: 0o700 });

  if (!sweptThisProcess) {
    sweptThisProcess = true;
    void sweepStaleTempWorkspaces({ root }).catch(() => undefined);
  }

  return mkdtemp(join(root, `${prefix}-`));
}

/** Test seam: lets a spec exercise the once-per-process sweep again. */
export function resetTempWorkspaceSweepForTests(): void {
  sweptThisProcess = false;
}
