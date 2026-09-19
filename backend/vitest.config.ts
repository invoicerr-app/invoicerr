import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

/**
 * Vitest config — the sole runner for the backend suite (NestJS 12 ships pure ESM; ts-jest's
 * CommonJS loader could not execute it — see the migration recipe for the full story).
 *
 * Jest and Vitest coexisted for the duration of the migration, coordinated by a manifest
 * (`vitest-migrated.json`) that each converted spec's PR added itself to: this file's own `include`
 * read it directly, and `jest.config.cjs` read the SAME file to exclude those paths from Jest, so
 * there was never a second place to update. That migration is over — every spec converted, the
 * manifest and `jest.config.cjs` deleted, Jest and ts-jest removed from `package.json` — so `include`
 * below now picks up every spec directly instead of going through that list.
 *
 * - `unplugin-swc` (not esbuild, Vite's own default TS transform): esbuild does not emit
 *   `design:paramtypes` decorator metadata at all, which Nest's DI reads to resolve constructor
 *   parameters by type. Under plain esbuild every `@nestjs/testing` module compiles and boots
 *   without error and hands back services with `undefined` in every injected slot — a silent
 *   correctness bug, not a crash. Confirmed with a throwaway repro during this migration: identical
 *   `Test.createTestingModule(...).compile()` call, esbuild resolves `undefined`, swc resolves the
 *   real instance. `unplugin-swc` reads `experimentalDecorators`/`emitDecoratorMetadata` straight out
 *   of this project's own tsconfig.json, so it stays in lockstep with the `nest build`/ts-jest
 *   configuration without a second, hand-maintained copy of those flags.
 * - `module: { type: 'nodenext' }`, not `'es6'`: Vite's own SSR pipeline (mocking, HMR-style module
 *   graph) needs the transform to keep ECMAScript `import`/`export` syntax, which rules out
 *   `'commonjs'` outright (a spec file doing that would import `vitest` itself via `require()`,
 *   which vitest's own commonjs entry point refuses on principle). But this project has 8 source
 *   files using TS's `import x = require('y')` interop form for an `export =` package under
 *   `esModuleInterop: false` (`mail/sanitize-email-html.ts`, `documents/actions/email-template.ts`,
 *   …) — legal only because `tsconfig.json`'s `moduleResolution: "nodenext"` lets tsc decide, per
 *   file, from the nearest `package.json`'s (absent, so CommonJS-default) `"type"` field, that this
 *   file compiles to CommonJS. `module: { type: 'es6' }` has no such per-file awareness and rejects
 *   the syntax outright ("Import assignment cannot be used when targeting ECMAScript modules") the
 *   instant a Vitest spec transitively imports one of those 8 files — which several specs in THIS
 *   migration's own sample do. `'nodenext'` is SWC's own per-file-aware mode (mirroring what tsc
 *   already does) and resolves both needs at once: spec files (and everything importing them) stay
 *   ESM for Vite's sake, the 8 CJS-interop files keep compiling. Do not "fix" this by rewriting those
 *   8 files' import syntax — that is an application source change to work around a test runner, which
 *   this migration deliberately does not do.
 * - `vite-tsconfig-paths` resolves the `@/` alias from tsconfig.json's own `paths` — the direct
 *   equivalent of Jest's `moduleNameMapper` entry for it, read from the same source of truth instead
 *   of a second copy.
 * - Jest's other `moduleNameMapper` entry, stripping a trailing `.js` off relative specifiers
 *   (`"^(\\.{1,2}/.*)\\.js$": "$1"`, needed because this project's `moduleResolution: "nodenext"`
 *   writes `./foo.js` against a source `./foo.ts`), has NO equivalent here because it needs none:
 *   Vite's own resolver already falls back from a `.js` specifier to a same-named `.ts` file when
 *   the `.js` file doesn't exist on disk. Confirmed with a throwaway repro; do not re-add this as a
 *   resolve alias, there is nothing broken to fix.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), swc.vite({ module: { type: 'nodenext' } })],
  test: {
    globals: true, // keeps describe/it/expect/vi ambient, exactly like ts-jest's own globals today
    root: './',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // Jest ran with maxWorkers: 4 (2 in CI, `--maxWorkers=2`, see cypress.yml's own comment on why).
    // `forks` isolates each test file in its own child process, same as a jest worker; `maxWorkers`
    // is Vitest 5's own top-level equivalent of Jest's flag of the same name (CLI --maxWorkers
    // overrides this exactly like it does for `jest --maxWorkers=2` today).
    pool: 'forks',
    maxWorkers: 4,
  },
});
