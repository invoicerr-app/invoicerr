import * as fs from 'node:fs';
import { join, relative } from 'node:path';

import { Logger } from '@nestjs/common';
import { vi } from 'vitest';

import type * as PlaywrightCoreMock from '../../../__mocks__/playwright-core';

/**
 * The three properties `PdfRendererWarmupService` exists to hold, in the order they matter:
 *  1. a process that renders starts its browser at BOOT, not on its first render;
 *  2. a process that renders nothing never starts one — proven structurally, because that is what
 *     actually decides it (see the suite's own header below);
 *  3. a warm-up that FAILS does not take the process down with it.
 *
 * The third is the one that protects every machine with no Chromium on it — a developer checkout
 * that never set `CHROMIUM_EXECUTABLE_PATH`, a self-hosted image built without a browser. Trading
 * "the first PDF is slow" for "the server refuses to start" would be a far worse bargain than the
 * one this whole service is making, so it is asserted twice below: once on the resolution failure
 * (no Chromium found at all) and once on the launch failure (a browser that is there but will not
 * start).
 */

// `render-pdf.ts` logs through `@/logger/logger.service`, which persists every call via
// `prisma.log.create` — without this mock, its `logger.debug`/`logger.error` calls would open a real
// connection attempt to a Postgres that does not exist in this test run. Same shape (and same
// reason) as `render-pdf.spec.ts`'s own.
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { log: { create: vi.fn().mockResolvedValue({}) } },
}));

// Vitest does not auto-discover this project's `src/__mocks__/playwright-core.ts` (its own mock root
// is `backend/`, not `backend/src/`) — naming the real relative path is what wires it in. See
// `render-pdf.spec.ts`'s own comment on this for the full account.
vi.mock('playwright-core', () => import('../../../__mocks__/playwright-core.js'));

// Vitest refuses to spy on a real ES module's namespace object; pre-mocking `node:fs` with a spread
// of its own real implementation swaps in a plain, configurable one, leaving every function's real
// behaviour intact while making `existsSync` spy-able. Needed by the "no Chromium anywhere" specs
// below, which must reach `resolveChromiumExecutablePath`'s not-found branch on a host that DOES have
// a system browser at one of the conventional paths just as reliably as on one that does not. Same
// mechanism, same reason, as `render-pdf.spec.ts`'s own.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual };
});

const ENV_KEYS = ['CHROMIUM_EXECUTABLE_PATH', 'PUPPETEER_EXECUTABLE_PATH'] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  // `resetModules()` does NOT reset a `vi.mock(id, factory)` module's own state — see `__mock.reset`'s
  // own header in the mock file. Reached through the same `playwright-core` specifier the code under
  // test imports, never the mock's relative path, which resolves to a different instance entirely.
  const playwrightCore = (await import('playwright-core')) as unknown as typeof PlaywrightCoreMock;
  playwrightCore.__mock.reset();
  for (const key of ENV_KEYS) delete process.env[key];
  // `resolveChromiumExecutablePath` returns an env value with no filesystem check, so a fake-but-set
  // path is enough to reach `chromium.launch()`; the "no Chromium anywhere" suite deletes it again.
  process.env.CHROMIUM_EXECUTABLE_PATH = '/mock/chromium-for-tests';
  // The service logs through Nest's own `Logger`, which writes to stdout. Silenced (not merely
  // observed) so an expected warning in the failure specs below never reads as a real test failure
  // in CI output.
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

/**
 * A freshly-loaded service alongside the freshly-loaded `render-pdf`/`playwright-core` pair it will
 * reach internally — `render-pdf.ts` caches its browser and its resolved executable path at module
 * scope, so every spec needs its own module instance rather than whatever a previous one left behind.
 */
async function load() {
  const { PdfRendererWarmupService } = await import('./pdf-renderer-warmup.service.js');
  const { renderPdf } = await import('./render-pdf.js');
  const playwrightCore = (await import('playwright-core')) as unknown as typeof PlaywrightCoreMock;
  return {
    service: new PdfRendererWarmupService(),
    renderPdf,
    chromium: playwrightCore.chromium,
    mock: playwrightCore.__mock,
  };
}

/**
 * The state of a machine with no browser on it at all: neither env var set, and nothing on disk —
 * the conventional system paths AND the path `playwright-core` computes for its own managed store
 * (which it reports whether or not anything was ever downloaded there, see
 * `resolvePlaywrightManagedExecutablePath`'s own header). Must be called BEFORE `load()`, since the
 * resolution happens on the first launch.
 */
function simulateHostWithNoChromium(): void {
  delete process.env.CHROMIUM_EXECUTABLE_PATH;
  delete process.env.PUPPETEER_EXECUTABLE_PATH;
  vi.spyOn(fs, 'existsSync').mockReturnValue(false);
}

describe('PdfRendererWarmupService — a process that renders', () => {
  it('launches the browser at bootstrap, before anything has asked for a PDF', async () => {
    const { service, chromium } = await load();

    expect(chromium.launch).not.toHaveBeenCalled();

    service.onApplicationBootstrap();
    await service.warmUp;

    expect(chromium.launch).toHaveBeenCalledTimes(1);
  });

  it('leaves that browser in place, so the first real render reuses it instead of launching its own', async () => {
    const { service, renderPdf, chromium, mock } = await load();

    service.onApplicationBootstrap();
    await service.warmUp;
    await renderPdf('<html><body>after the warm-up</body></html>');

    // The whole point: one launch for the process, paid at boot — the render that followed opened a
    // page on it and started nothing.
    expect(chromium.launch).toHaveBeenCalledTimes(1);
    expect(mock.browsers).toHaveLength(1);
    expect(mock.pages).toHaveLength(1);
  });

  it('opens no page and renders nothing — the launch is the cost, a throwaway render would only hold a render slot', async () => {
    const { service, mock } = await load();

    service.onApplicationBootstrap();
    await service.warmUp;

    expect(mock.pages).toHaveLength(0);
  });

  it('does not block bootstrap: the hook returns nothing, so Nest awaits nothing', async () => {
    const { service } = await load();

    // Returning the promise is exactly what would make Nest await it — and the worker binds its
    // :3001 health server only AFTER `init()` returns, so a slow launch awaited here would eat the
    // readiness budget the chart allows and, at the worst measured launch times, reach the liveness
    // one. `undefined` is the assertion that it cannot.
    expect(service.onApplicationBootstrap()).toBeUndefined();

    await service.warmUp;
  });
});

/**
 * Which PROCESSES warm up is not a runtime decision this class makes — it has no role check in it,
 * deliberately. It is decided by which module registers it, and that is `DocumentsCoreModule`: the
 * providers-only module loaded by exactly the two processes that can render a PDF (the dedicated
 * `ROLE=worker`, for queued sends; the API, which renders synchronously inside `GET /documents/:id/pdf`
 * and its siblings, none of them gated on `WORKER_INLINE`). A process that loads neither never
 * constructs this class at all.
 *
 * So the "never renders, never warms up" guarantee is a structural one, and this is what holds it:
 * a single registration, in that one module. A future registration added anywhere else — a root
 * module, a process-local module, a feature module some non-rendering entrypoint happens to load —
 * would start a browser in a process that has no use for one, and would do it silently.
 */
describe('PdfRendererWarmupService — a process that renders nothing', () => {
  const SRC_ROOT = join(__dirname, '..', '..', '..');

  /** Every Nest module file under `src` — the only kind of file that can put this service into a
   *  process's DI graph, which is the only way its bootstrap hook ever runs. Other files may NAME the
   *  class (its own definition does, and so does `render-pdf.ts`'s comment pointing back at it);
   *  naming it registers nothing. */
  function listModuleFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return listModuleFiles(full);
      return entry.isFile() && full.endsWith('.module.ts') ? [full] : [];
    });
  }

  it('is registered by exactly one Nest module — the one every rendering process loads, and nothing else', () => {
    const registeredBy = listModuleFiles(SRC_ROOT)
      .filter((file) => fs.readFileSync(file, 'utf-8').includes('PdfRendererWarmupService'))
      .map((file) => relative(SRC_ROOT, file).replaceAll('\\', '/'));

    expect(registeredBy).toEqual(['modules/documents/documents-core.module.ts']);
  });

  it('starts no browser merely by existing — only the bootstrap hook does', async () => {
    const { chromium } = await load();

    // `load()` already constructed the service. Importing the module and building the DI graph is
    // everything a process gets for free; a process that never bootstraps this module never reaches
    // the line below's counterpart.
    expect(chromium.launch).not.toHaveBeenCalled();
  });
});

describe('PdfRendererWarmupService — a warm-up that fails', () => {
  it('does not throw out of the bootstrap hook when no Chromium can be found at all', async () => {
    // A developer checkout, and any self-hosted image built without a browser: `playwright-core`
    // bundles none, so with both env vars unset and nothing on disk `resolveChromiumExecutablePath`
    // throws by design.
    simulateHostWithNoChromium();
    const { service, chromium } = await load();

    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await expect(service.warmUp).resolves.toBeUndefined();

    // It never even got as far as trying to start one — the failure is the resolution, not the launch.
    expect(chromium.launch).not.toHaveBeenCalled();
  });

  it('does not throw out of the bootstrap hook when the browser is there but will not start', async () => {
    const { service, chromium } = await load();
    chromium.launch.mockRejectedValue(new Error('Failed to launch: spawn EACCES'));

    expect(() => service.onApplicationBootstrap()).not.toThrow();
    await expect(service.warmUp).resolves.toBeUndefined();
  });

  it('says in the log what is now going to be slow, and why', async () => {
    simulateHostWithNoChromium();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { service } = await load();

    service.onApplicationBootstrap();
    await service.warmUp;

    // An operator reading startup logs has to be able to tell what they are now giving up, not just
    // that something failed — and the underlying error names the fix (which env var to set).
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain('first PDF');
    expect(message).toContain('CHROMIUM_EXECUTABLE_PATH');
  });

  it('leaves the first render failing exactly as it does today — no better, no worse', async () => {
    simulateHostWithNoChromium();
    const { service, renderPdf } = await load();

    service.onApplicationBootstrap();
    await service.warmUp;

    // The same named error `render-pdf.ts` has always raised for an unresolvable browser. A failed
    // warm-up must not have cached a broken state, swallowed the diagnostic, or changed the message.
    await expect(renderPdf('<html><body>no browser</body></html>')).rejects.toThrow(
      /PDF renderer unavailable: no Chromium executable found/,
    );
  });
});
