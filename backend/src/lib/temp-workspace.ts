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
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** How long a directory may survive without its owner: long enough for a slow export on a busy
 *  instance, short enough that a crash does not leave a company's data on disk for a week. */
export const TEMP_WORKSPACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Set to move the root (a tmpfs mount, a volume with a size cap). Default: `<tmp>/invoicerr-temp`. */
export const TEMP_WORKSPACE_DIR_ENV = 'DOCUMENTS_TEMP_DIR';

/**
 * Empty file every workspace this module creates carries. The sweep deletes a directory only when
 * this marker is present, so a foreign directory that happens to live under the same root (an
 * operator's own scratch directory, another tool's cache) is never removed, however old it is.
 */
export const TEMP_WORKSPACE_MARKER = '.invoicerr-workspace';

export function tempWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env[TEMP_WORKSPACE_DIR_ENV]?.trim();
  return configured ? configured : join(tmpdir(), 'invoicerr-temp');
}

/**
 * Refuses a root that is not a directory this process may treat as private.
 *
 * The root used to be passed straight to `mkdir({ recursive: true })`, which silently accepts a
 * symlink already sitting at that path: every workspace then landed in whatever the link pointed at,
 * and `rm({ recursive: true })` during the sweep could erase a directory the application never
 * created. `lstat`, never `stat`, so the link itself is what gets inspected. The owner and mode
 * checks are the same guarantee one level up: a root readable by another local user exposes every
 * company export written under it, so it is refused rather than quietly used.
 *
 * A missing root is not an error here: the caller creates it and checks again.
 */
async function assertSafeRoot(root: string): Promise<void> {
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (info === null) return;

  if (info.isSymbolicLink()) {
    throw new Error(`Temp workspace root ${root} is a symbolic link; refusing to use it.`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Temp workspace root ${root} is not a directory; refusing to use it.`);
  }
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
    throw new Error(
      `Temp workspace root ${root} is owned by uid ${info.uid}, not by this process (uid ${process.getuid()}); refusing to use it.`,
    );
  }
  const mode = info.mode & 0o777;
  if (mode !== 0o700) {
    throw new Error(
      `Temp workspace root ${root} has mode 0o${mode.toString(8)}; it must be 0700. Run: chmod 0700 ${root}`,
    );
  }
}

export interface SweepOptions {
  root?: string;
  maxAgeMs?: number;
  now?: () => number;
}

/**
 * Deletes directories this module created under the root when they are older than `maxAgeMs`.
 * Returns how many it removed. Never throws: a missing root is not an error (nothing has been written
 * yet), an unsafe root is left alone, and a directory that cannot be read or removed is skipped
 * rather than aborting the caller.
 *
 * Only marked directories are candidates (`TEMP_WORKSPACE_MARKER`). Directories created before the
 * marker existed are therefore never swept; they are a one-off cleanup for the operator, not
 * something this function can safely guess at.
 */
export async function sweepStaleTempWorkspaces(options: SweepOptions = {}): Promise<{ removed: number }> {
  const root = options.root ?? tempWorkspaceRoot();
  const maxAgeMs = options.maxAgeMs ?? TEMP_WORKSPACE_MAX_AGE_MS;
  const now = options.now ?? Date.now;

  try {
    await assertSafeRoot(root);
  } catch {
    return { removed: 0 };
  }

  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { removed: 0 };
  }

  let removed = 0;
  for (const entry of entries) {
    // `withFileTypes` reports the link itself, so a symlink to a directory is skipped here rather
    // than followed and recursively deleted.
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    const marker = await lstat(join(path, TEMP_WORKSPACE_MARKER)).catch(() => null);
    if (!marker?.isFile()) continue;
    const info = await lstat(path).catch(() => null);
    if (!info || now() - info.mtimeMs < maxAgeMs) continue;
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    removed++;
  }
  return { removed };
}

let sweptThisProcess = false;

/**
 * Creates a fresh `0700` directory for one unit of work, carrying the marker the sweep looks for. The
 * first call in a process also runs the stale-artifact sweep once, asynchronously: the caller's own
 * directory is freshly created and thus never a candidate, so the sweep cannot race what it is about
 * to return.
 *
 * The root is checked with `lstat` BEFORE `mkdir`: `mkdir({ recursive: true })` on a pre-existing
 * symlink succeeds silently and would put every workspace behind that link.
 */
export async function createTempWorkspace(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const root = tempWorkspaceRoot(env);
  await assertSafeRoot(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  // Check what actually exists now, not what we asked for: `mode` is filtered by the umask, and a
  // path swapped between the first check and the `mkdir` would otherwise go unnoticed.
  await assertSafeRoot(root);

  if (!sweptThisProcess) {
    sweptThisProcess = true;
    void sweepStaleTempWorkspaces({ root }).catch(() => undefined);
  }

  const dir = await mkdtemp(join(root, `${prefix}-`));
  try {
    await writeFile(join(dir, TEMP_WORKSPACE_MARKER), '', { mode: 0o600 });
  } catch (error) {
    // Without its marker the directory would never be swept, so a failed write removes it here.
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return dir;
}

/** Test seam: lets a spec exercise the once-per-process sweep again. */
export function resetTempWorkspaceSweepForTests(): void {
  sweptThisProcess = false;
}
