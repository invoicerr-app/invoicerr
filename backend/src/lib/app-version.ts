/**
 * Resolves the "real" installed version — the same problem PR #369 already solved for
 * `swagger-document.ts`'s own Swagger `.setVersion()` (`entrypoint.sh` `cd`s into `backend/src`
 * before starting node, so `process.cwd()` never has `package.json` next to it), now shared here so
 * `modules/version/version.service.ts` (`GET /api/version` — "you're on vX, a newer one exists")
 * does not duplicate the same twin-path lookup a second time.
 *
 * ## Why the update-check feature does NOT just use `readBackendPackageJsonVersion()`
 * `backend/package.json`'s own `version` field has never tracked this product's actual releases — it
 * reads "0.0.1" while GitHub's newest tag is `v2.0.0-alpha.1` (checked 2026-09-23, pre-existing, not
 * something this file fixes). What DOES track the real release is `INVOICERR_REF_NAME`, the
 * Dockerfile's own build-time env var baked from the exact git ref the image was built from — a
 * release tag on a real release build (`docker-publish.yml`'s `GIT_REF_NAME=${{ github.ref_name }}`),
 * a branch name on a dev/PR image (`docker-pr.yml`). `getInstalledVersion()` below prefers it for
 * exactly that reason: it is the one source that is guaranteed to mean the same thing as a GitHub
 * release tag when it IS one. `readBackendPackageJsonVersion()` stays the fallback for a run that
 * never went through that Dockerfile at all (`npm run start:dev`) — the same place PR #369's fix
 * already covered, and still exactly what `swagger-document.ts` uses, unchanged.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `backend/package.json`'s own `version` field, resolved relative to `__dirname` — never
 * `process.cwd()` (see this file's own header). Two candidate depths because `__dirname` differs
 * between a compiled run (`dist/src/lib`, `nest build`) and `ts-node`/Vitest (`src/lib`) — one level
 * deeper than `swagger-document.ts`'s own original version of this lookup since this file lives in
 * `src/lib/`, not `src/`.
 *
 * Throws if neither resolves — intentional, same as the code this replaces: a production image
 * genuinely missing `package.json` next to the backend it just booted is a real problem worth
 * failing loud on, not silently swallowing (see `main.ts`'s own boot-time assertions for the same
 * doctrine). `getInstalledVersion()` below is the one caller that deliberately does NOT want that:
 * it catches this and falls back to a plain "unknown" rather than ever letting a version DISPLAY
 * crash the app.
 */
export function readBackendPackageJsonVersion(): string {
  const packageJsonPath = [
    join(__dirname, '..', '..', '..', 'package.json'), // compiled: dist/src/lib -> backend
    join(__dirname, '..', '..', 'package.json'), // ts-node/Vitest: src/lib -> backend
  ].find(existsSync)!;
  const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  return version;
}

export interface InstalledVersion {
  /** The exact string to display, and — only when `fromBuildRef` is true — to compare against a
   *  GitHub release tag. */
  version: string;
  /** `true` when `version` came from `INVOICERR_REF_NAME` (a real build's own git ref). `false` means
   *  the `package.json` fallback (or the final "unknown" fallback below), neither of which is a real
   *  release version — `version.service.ts` displays them but never compares them against GitHub. */
  fromBuildRef: boolean;
}

export function getInstalledVersion(): InstalledVersion {
  const refName = process.env.INVOICERR_REF_NAME;
  if (refName && refName !== 'unknown') {
    return { version: refName, fromBuildRef: true };
  }
  try {
    return { version: readBackendPackageJsonVersion(), fromBuildRef: false };
  } catch {
    return { version: 'unknown', fromBuildRef: false };
  }
}
