import { vi } from 'vitest';
import * as fs from 'node:fs';

import type * as PlaywrightCoreMock from '../../../__mocks__/playwright-core';

// `render-pdf.ts` logs through `@/logger/logger.service`, which persists every call via
// `prisma.log.create` — without this mock, every `logger.debug`/`logger.error` call in the specs
// below would open a real connection attempt to a Postgres that doesn't exist in this test run, which
// is exactly what left jest unable to exit cleanly before this mock was added. Same shape
// `archive-on-send.spec.ts` already uses for the same reason.
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { log: { create: vi.fn().mockResolvedValue({}) } },
}));

// `playwright-core` is a `node_modules` package. Jest wired up its manual mock
// (`src/__mocks__/playwright-core.ts`, see that file's own header) automatically project-wide, just
// because it exists, using its own `rootDir: "src"` to find `<rootDir>/__mocks__`. Vitest's equivalent
// auto-discovery looks under its OWN configured `root` instead (`vitest.config.ts` sets `root: './'`,
// i.e. `backend/`, not `backend/src/`) — confirmed empirically by reading `@vitest/mocker`'s own
// `findMockRedirect` (`join(root, '__mocks__', ...)`), so a bare `vi.mock('playwright-core')` here
// would NOT find this project's mock file and would fall through to blind auto-mocking (every export
// replaced with a bare `vi.fn()`, none of the stateful `chromium.launch`/`mock.pages`/`mock.browsers`
// behavior every test below actually asserts on). Naming the real relative path explicitly sidesteps
// that root mismatch entirely, without touching the shared `vitest.config.ts`.
vi.mock('playwright-core', () => import('../../../__mocks__/playwright-core.js'));

// `node:fs` is loaded here as a namespace import (`import * as fs`) specifically so individual specs
// below can `vi.spyOn(fs, 'existsSync')` — but Vitest refuses to spy directly on a REAL ES module's
// namespace object at all ("Cannot spy on export ... Module namespace is not configurable in ESM"),
// which a bare Jest spy on the same export never hit (Jest's own CJS interop namespace was always a
// plain, writable object). Pre-mocking the module with a spread of its own real implementation swaps
// in a plain, configurable object in its place — every OTHER `fs` function keeps its real behavior,
// and `existsSync` becomes spy-able exactly like it was under Jest.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return { ...actual };
});

const ENV_KEYS = ['CHROMIUM_EXECUTABLE_PATH', 'PUPPETEER_EXECUTABLE_PATH', 'PDF_RENDER_CONCURRENCY'] as const;
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
  // Undoes any `vi.spyOn(fs, ...)` a previous test installed — `fs` is a Node core module, not
  // something `resetModules()` itself touches, so a spy left dangling here would leak into whichever
  // test runs next.
  vi.restoreAllMocks();
  // `resetModules()` above does NOT reset the `playwright-core` manual mock's own state — see
  // `__mock.reset()`'s own header for why (a `vi.mock(id, factory)` factory's produced module is not
  // one of the modules `resetModules()` invalidates) — without this, `mock.pages`/`mock.browsers` and
  // `chromium.launch`'s call history would keep accumulating across every test in this file.
  //
  // Reached via `import('playwright-core')` (the SAME specifier `render-pdf.ts` itself imports),
  // never a plain relative import of the mock file's own path: measured directly while converting
  // this file that the two resolve to genuinely DIFFERENT module instances under Vitest's mock
  // redirection (`vi.mock('playwright-core', factory)` produces its own separate instance) — a
  // relative import's `__mock.reset()` silently resets an instance nothing else ever reads from.
  const playwrightCore = (await import('playwright-core')) as unknown as typeof PlaywrightCoreMock;
  playwrightCore.__mock.reset();
  for (const key of ENV_KEYS) delete process.env[key];
  // `resolveChromiumExecutablePath` returns an env-var value straight away, with no filesystem check
  // at all — so a fake-but-present path is enough for every spec except the executable-RESOLUTION
  // ones below, which delete this themselves and drive the conventional-path / not-found branches.
  process.env.CHROMIUM_EXECUTABLE_PATH = '/mock/chromium-for-tests';
});

/**
 * Loads a fresh `render-pdf` module together with the (also fresh, thanks to `resetModules` above)
 * mocked `playwright-core` it will import internally. Both `MAX_CONCURRENT_RENDERS` and the
 * resolved Chromium path are read ONCE at module load, so the env vars for a given test must be set
 * BEFORE this is called, not just before `renderPdf()` is invoked.
 */
async function load() {
  // A dynamic `import()`, not `require()`: Vitest's injected `require` shim resolves a relative
  // specifier literally (no TypeScript-aware `./foo` -> `./foo.ts` fallback the way `import` gets),
  // so `require('./render-pdf')` here would throw "Cannot find module" — and going through the same
  // ESM import pipeline `vi.mock`/`resetModules()` themselves operate on is also what lets this
  // actually observe a genuinely fresh, re-mocked `playwright-core` on every call.
  const { renderPdf } = await import('./render-pdf.js');
  const playwrightCore = (await import('playwright-core')) as unknown as typeof PlaywrightCoreMock;
  return { renderPdf, chromium: playwrightCore.chromium, mock: playwrightCore.__mock };
}

describe('renderPdf', () => {
  it('passes explicit, non-zero margins on every side — Playwright (unlike Puppeteer) defaults all four to zero', async () => {
    const { renderPdf, mock } = await load();

    await renderPdf('<html><body>hello</body></html>');

    expect(mock.pages).toHaveLength(1);
    const [options] = mock.pages[0].pdf.mock.calls[0];
    expect(options).toMatchObject({
      format: 'A4',
      printBackground: true,
      margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
    });
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const value = (options as { margin: Record<string, unknown> }).margin[side];
      expect(value).not.toBe(0);
      expect(value).not.toBe('0');
    }
  });

  // Portugal's ATCUD "on every page" (Portaria n.º 195/2020, art. 4.º n.º 3) — the ONLY expressible
  // mechanism for that, given render-html.ts's own CSS has no `@page`/page-break control at all: see
  // `RenderPdfOptions.footerText`'s own header.
  describe('footerText — the "on every page" ATCUD mechanism', () => {
    it('is absent by default — byte-for-byte the SAME page.pdf() options every other document already got', async () => {
      const { renderPdf, mock } = await load();

      await renderPdf('<html><body>hello</body></html>');

      const [options] = mock.pages[0].pdf.mock.calls[0] as [Record<string, unknown>];
      expect(options).not.toHaveProperty('displayHeaderFooter');
      expect(options).not.toHaveProperty('footerTemplate');
      expect(options).not.toHaveProperty('headerTemplate');
      expect((options.margin as Record<string, unknown>).bottom).toBe('1cm');
    });

    it('turns on a repeating footer, with the given text, and grows the bottom margin to fit it', async () => {
      const { renderPdf, mock } = await load();

      await renderPdf('<html><body>hello</body></html>', { footerText: 'ATCUD:JCVPTS0J-0007' });

      const [options] = mock.pages[0].pdf.mock.calls[0] as [Record<string, unknown>];
      expect(options.displayHeaderFooter).toBe(true);
      expect(options.footerTemplate).toContain('ATCUD:JCVPTS0J-0007');
      expect(options.headerTemplate).toBe('<span></span>');
      expect((options.margin as Record<string, unknown>).bottom).toBe('1.4cm');
      // Every OTHER side is untouched by the footer option.
      expect((options.margin as Record<string, unknown>).top).toBe('1cm');
    });

    it('HTML-escapes the footer text — a company-typed validation code must never inject markup', async () => {
      const { renderPdf, mock } = await load();

      await renderPdf('<html></html>', { footerText: '<script>alert(1)</script>' });

      const [options] = mock.pages[0].pdf.mock.calls[0] as [Record<string, unknown>];
      expect(options.footerTemplate).not.toContain('<script>');
      expect(options.footerTemplate).toContain('&lt;script&gt;');
    });
  });

  it('launches exactly one browser when two renders race to be the first', async () => {
    const { renderPdf, chromium, mock } = await load();

    const [pdfA, pdfB] = await Promise.all([renderPdf('<html>A</html>'), renderPdf('<html>B</html>')]);

    expect(chromium.launch).toHaveBeenCalledTimes(1);
    expect(mock.browsers).toHaveLength(1);
    // Both renders still complete normally against the single shared browser.
    expect(Buffer.isBuffer(pdfA)).toBe(true);
    expect(Buffer.isBuffer(pdfB)).toBe(true);
  });

  it('never has more open pages than the configured concurrency cap', async () => {
    process.env.PDF_RENDER_CONCURRENCY = '2';
    const { renderPdf, mock } = await load();
    // Long enough that several of the 6 renders below are genuinely in flight together — with no
    // delay, each page could open and close before the next call's newPage() even runs, and the peak
    // would never actually reach the cap (proving the limiter never OVER-admits, but not that it
    // permits real concurrency up to the configured number).
    mock.setPdfDelayMs(20);

    await Promise.all(Array.from({ length: 6 }, (_, i) => renderPdf(`<html>${i}</html>`)));

    expect(mock.pages).toHaveLength(6);
    expect(mock.maxOpenPages).toBe(2);
  });

  it('closes the page even when page.pdf() throws, and never closes the shared browser', async () => {
    const { renderPdf, mock } = await load();
    mock.failNextPdf(new Error('boom'));

    await expect(renderPdf('<html></html>')).rejects.toThrow('PDF rendering failed: boom');

    expect(mock.pages).toHaveLength(1);
    expect(mock.pages[0].close).toHaveBeenCalledTimes(1);
    expect(mock.browsers).toHaveLength(1);
    expect(mock.browsers[0].close).not.toHaveBeenCalled();
  });

  it('relaunches a fresh browser once the shared one has disconnected', async () => {
    const { renderPdf, chromium, mock } = await load();

    await renderPdf('<html>first</html>');
    expect(mock.browsers).toHaveLength(1);

    mock.browsers[0].isConnected.mockReturnValue(false);
    await renderPdf('<html>second</html>');

    expect(mock.browsers).toHaveLength(2);
    expect(chromium.launch).toHaveBeenCalledTimes(2);
  });

  describe('Chromium executable resolution', () => {
    it('prefers CHROMIUM_EXECUTABLE_PATH over the legacy alias', async () => {
      process.env.CHROMIUM_EXECUTABLE_PATH = '/current/chromium';
      process.env.PUPPETEER_EXECUTABLE_PATH = '/legacy/chrome';
      const { renderPdf, chromium } = await load();

      await renderPdf('<html></html>');

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: '/current/chromium' }),
      );
    });

    it('falls back to the legacy PUPPETEER_EXECUTABLE_PATH when CHROMIUM_EXECUTABLE_PATH is unset', async () => {
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
      process.env.PUPPETEER_EXECUTABLE_PATH = '/legacy/chrome';
      const { renderPdf, chromium } = await load();

      await renderPdf('<html></html>');

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: '/legacy/chrome' }),
      );
    });

    it('falls back to a conventional system path when neither env var is set', async () => {
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
      vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => candidate === '/usr/bin/chromium-browser');
      const { renderPdf, chromium } = await load();

      await renderPdf('<html></html>');

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: '/usr/bin/chromium-browser' }),
      );
    });

    it('throws a named, actionable error naming the env vars when no Chromium can be found anywhere', async () => {
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const { renderPdf } = await load();

      let thrown: Error | undefined;
      try {
        await renderPdf('<html></html>');
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeDefined();
      expect(thrown?.message).toContain('CHROMIUM_EXECUTABLE_PATH');
      expect(thrown?.message).toContain('PUPPETEER_EXECUTABLE_PATH');
      // The regression this whole file exists to close: outside Docker, neither env var nor a system
      // package is a given, so the error must also name the one command that actually gets someone
      // unstuck — installing playwright-core's own matched browser.
      expect(thrown?.message).toContain('playwright-core install chromium');
    });

    it("consults playwright-core's own browser store (chromium.executablePath()) when both env vars are unset, no conventional system path exists, and the reported path actually exists on disk", async () => {
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
      const managedPath = '/mock/ms-playwright/chromium-1243/chrome-linux64/chrome';
      // Only the managed path "exists" — conventional paths must still miss, so this spec proves the
      // managed-browser rule is what matched, not an accidental fall-through.
      vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => candidate === managedPath);
      const { renderPdf, chromium } = await load();
      chromium.executablePath.mockReturnValue(managedPath);

      await renderPdf('<html></html>');

      expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ executablePath: managedPath }));
    });

    it('ignores chromium.executablePath() when it returns a path that does not exist on disk, and falls through to a conventional system path instead — the regression this existence check exists to prevent', async () => {
      // Real `playwright-core` computes and returns this kind of path unconditionally, whether or not
      // `npx playwright-core install chromium` was ever run — it does NOT throw for "not installed"
      // (see `resolvePlaywrightManagedExecutablePath`'s header in `render-pdf.ts`, and the manual
      // mock's default, which already returns exactly this shape of never-installed path). A host with
      // a system Chrome but no playwright-core install must still resolve to that system browser
      // instead of trying to launch a file that was never downloaded.
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
      vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => candidate === '/usr/bin/chromium-browser');
      const { renderPdf, chromium } = await load();
      chromium.executablePath.mockReturnValue('/mock/ms-playwright/chromium-1243/chrome-linux64/chrome');

      await renderPdf('<html></html>');

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: '/usr/bin/chromium-browser' }),
      );
    });

    it('treats a throwing chromium.executablePath() as "no match" and falls through to the conventional system paths, rather than propagating — a secondary possibility, kept handled even though the common "not installed" case is the non-existent-path one above', async () => {
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
      vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => candidate === '/usr/bin/chromium-browser');
      const { renderPdf, chromium } = await load();
      chromium.executablePath.mockImplementation(() => {
        throw new Error("Executable doesn't exist");
      });

      await renderPdf('<html></html>');

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: '/usr/bin/chromium-browser' }),
      );
    });
  });
});
