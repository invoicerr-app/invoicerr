import * as fs from 'node:fs';

import type * as PlaywrightCoreMock from '../../../__mocks__/playwright-core';

// `render-pdf.ts` logs through `@/logger/logger.service`, which persists every call via
// `prisma.log.create` — without this mock, every `logger.debug`/`logger.error` call in the specs
// below would open a real connection attempt to a Postgres that doesn't exist in this test run, which
// is exactly what left jest unable to exit cleanly before this mock was added. Same shape
// `archive-on-send.spec.ts` already uses for the same reason.
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { log: { create: jest.fn().mockResolvedValue({}) } },
}));

// `playwright-core` is a `node_modules` package, so Jest actually wires up its manual mock
// (`src/__mocks__/playwright-core.ts`, see that file's own header) automatically, project-wide, just
// because it exists — this call is not strictly required, but documents that dependency at the call
// site rather than relying on that file's mere existence being obvious to a reader. Either way, every
// test below asserts on `chromium.launch`/`mock.pages`/`mock.browsers`, which only exist on the MOCK:
// if the mock were ever NOT in effect, `require('playwright-core')` would return the real package and
// those assertions would fail (or, worse, the test would try to launch a real browser) rather than
// silently passing on nothing.
jest.mock('playwright-core');

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

beforeEach(() => {
  jest.resetModules();
  // Undoes any `jest.spyOn(fs, ...)` a previous test installed — `fs` is a Node core module, not
  // something `resetModules()` itself touches, so a spy left dangling here would leak into whichever
  // test runs next.
  jest.restoreAllMocks();
  for (const key of ENV_KEYS) delete process.env[key];
  // `resolveChromiumExecutablePath` returns an env-var value straight away, with no filesystem check
  // at all — so a fake-but-present path is enough for every spec except the executable-RESOLUTION
  // ones below, which delete this themselves and drive the conventional-path / not-found branches.
  process.env.CHROMIUM_EXECUTABLE_PATH = '/mock/chromium-for-tests';
});

/**
 * Loads a fresh `render-pdf` module together with the (also fresh, thanks to `resetModules` above)
 * mocked `playwright-core` it will `require()` internally. Both `MAX_CONCURRENT_RENDERS` and the
 * resolved Chromium path are read ONCE at module load, so the env vars for a given test must be set
 * BEFORE this is called, not just before `renderPdf()` is invoked.
 */
function load() {
  const { renderPdf } = require('./render-pdf') as typeof import('./render-pdf');
  const playwrightCore = require('playwright-core') as typeof PlaywrightCoreMock;
  return { renderPdf, chromium: playwrightCore.chromium, mock: playwrightCore.__mock };
}

describe('renderPdf', () => {
  it('passes explicit, non-zero margins on every side — Playwright (unlike Puppeteer) defaults all four to zero', async () => {
    const { renderPdf, mock } = load();

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

  it('launches exactly one browser when two renders race to be the first', async () => {
    const { renderPdf, chromium, mock } = load();

    const [pdfA, pdfB] = await Promise.all([renderPdf('<html>A</html>'), renderPdf('<html>B</html>')]);

    expect(chromium.launch).toHaveBeenCalledTimes(1);
    expect(mock.browsers).toHaveLength(1);
    // Both renders still complete normally against the single shared browser.
    expect(Buffer.isBuffer(pdfA)).toBe(true);
    expect(Buffer.isBuffer(pdfB)).toBe(true);
  });

  it('never has more open pages than the configured concurrency cap', async () => {
    process.env.PDF_RENDER_CONCURRENCY = '2';
    const { renderPdf, mock } = load();
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
    const { renderPdf, mock } = load();
    mock.failNextPdf(new Error('boom'));

    await expect(renderPdf('<html></html>')).rejects.toThrow('PDF rendering failed: boom');

    expect(mock.pages).toHaveLength(1);
    expect(mock.pages[0].close).toHaveBeenCalledTimes(1);
    expect(mock.browsers).toHaveLength(1);
    expect(mock.browsers[0].close).not.toHaveBeenCalled();
  });

  it('relaunches a fresh browser once the shared one has disconnected', async () => {
    const { renderPdf, chromium, mock } = load();

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
      const { renderPdf, chromium } = load();

      await renderPdf('<html></html>');

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: '/current/chromium' }),
      );
    });

    it('falls back to the legacy PUPPETEER_EXECUTABLE_PATH when CHROMIUM_EXECUTABLE_PATH is unset', async () => {
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
      process.env.PUPPETEER_EXECUTABLE_PATH = '/legacy/chrome';
      const { renderPdf, chromium } = load();

      await renderPdf('<html></html>');

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: '/legacy/chrome' }),
      );
    });

    it('falls back to a conventional system path when neither env var is set', async () => {
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
      jest
        .spyOn(fs, 'existsSync')
        .mockImplementation((candidate) => candidate === '/usr/bin/chromium-browser');
      const { renderPdf, chromium } = load();

      await renderPdf('<html></html>');

      expect(chromium.launch).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: '/usr/bin/chromium-browser' }),
      );
    });

    it('throws a named, actionable error naming the env vars when no Chromium can be found anywhere', async () => {
      delete process.env.CHROMIUM_EXECUTABLE_PATH;
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const { renderPdf } = load();

      let thrown: Error | undefined;
      try {
        await renderPdf('<html></html>');
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown).toBeDefined();
      expect(thrown?.message).toContain('CHROMIUM_EXECUTABLE_PATH');
      expect(thrown?.message).toContain('PUPPETEER_EXECUTABLE_PATH');
    });
  });
});
