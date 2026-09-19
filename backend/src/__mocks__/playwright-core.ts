/**
 * Manual mock for the small slice of `playwright-core` that `rendering/render-pdf.ts` actually
 * touches: `chromium.launch()`, and the `Browser`/`Page` methods it calls on what that returns.
 *
 * Lives under `backend/src/__mocks__/` (NOT a root-level `__mocks__/`) because this project's Jest
 * config sets `rootDir: "src"` — Jest looks for a node-module manual mock adjacent to each configured
 * `root`, and `src` is the only one here. Unlike a mock colocated next to a first-party module (which
 * needs an explicit `vi.mock('./local-module')` per spec), a manual mock for a `node_modules`
 * package like this one used to be wired in AUTOMATICALLY for every test in the project once this file
 * existed, under Jest. Vitest has no equivalent auto-discovery for THIS project's own config (it looks
 * under its own configured `root`, which here is `backend/`, not `backend/src/` — see
 * `render-pdf.spec.ts`'s own header for the empirical confirmation), so that spec now wires this file
 * in explicitly with `vi.mock('playwright-core', () => import('../../../__mocks__/playwright-core'))`
 * rather than relying on this file's mere existence.
 *
 * Deliberately fakes a whole browser/page pair rather than stubbing `renderPdf` itself: the specs this
 * mock exists for (the launch mutex, the concurrency cap, "page closed but browser kept alive on
 * error") are all about how `render-pdf.ts` sequences calls onto `chromium`/`Browser`/`Page` — stubbing
 * `renderPdf` would test nothing.
 */
import { vi, type Mock } from 'vitest';

type MockPage = {
  setContent: Mock<(content: string, options?: unknown) => Promise<void>>;
  pdf: Mock<(options?: unknown) => Promise<Buffer>>;
  close: Mock<() => Promise<void>>;
};

type MockBrowser = {
  isConnected: Mock<() => boolean>;
  newPage: Mock<() => Promise<MockPage>>;
  close: Mock<() => Promise<void>>;
};

/** Every page/browser this mock has ever handed out, in creation order — specs read these directly
 *  instead of digging through the mock's own `.mock.results`, so a spec reads as "the second page" rather
 *  than "the resolved value of the second call". */
const pages: MockPage[] = [];
const browsers: MockBrowser[] = [];

/** How many mock pages are "open" (created but not yet closed) right now, and the highest that count
 *  ever reached — read by the concurrency-limit spec, which is the only thing that cares about the
 *  peak rather than the current value. */
let openPages = 0;
let maxOpenPages = 0;

/** Artificial delay (ms) `page.pdf()` waits before resolving. Zero by default, which is fine for
 *  every spec except the concurrency-limit one: with several `renderPdf()` calls started together but
 *  no delay, each page could open and close before the next call's `newPage()` even runs, and
 *  `maxOpenPages` would never actually reach the cap — proving nothing about whether the limiter
 *  permits real concurrency, only that it never (accidentally) exceeds it. */
let pdfDelayMs = 0;

/** Set by a spec to make the NEXT `page.pdf()` call reject instead of resolving — proving the page is
 *  still closed, and the browser still left open, when rendering itself fails. Consumed once. */
let nextPdfError: Error | null = null;

function createPage(): MockPage {
  const page: MockPage = {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockImplementation(async () => {
      if (nextPdfError) {
        const error = nextPdfError;
        nextPdfError = null;
        throw error;
      }
      if (pdfDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pdfDelayMs));
      }
      return Buffer.from('%PDF-1.4 mock document');
    }),
    close: vi.fn().mockImplementation(async () => {
      openPages--;
    }),
  };
  pages.push(page);
  return page;
}

function createBrowser(connected = true): MockBrowser {
  const browser: MockBrowser = {
    isConnected: vi.fn().mockReturnValue(connected),
    newPage: vi.fn().mockImplementation(async () => {
      openPages++;
      maxOpenPages = Math.max(maxOpenPages, openPages);
      return createPage();
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
  browsers.push(browser);
  return browser;
}

// Real `playwright-core` does NOT throw here when it has no managed browser to report (the common
// case in this test run — nothing under this repo's test install ever runs `playwright-core install`)
// — measured directly, see `resolvePlaywrightManagedExecutablePath`'s own header in `render-pdf.ts`.
// It instead returns a COMPUTED path for a browser that was never downloaded, so the default here
// returns a path that does not exist on disk, matching that real mechanism and exercising the same
// "no match, fall through" behaviour the guard in `render-pdf.ts` is written to handle via
// `existsSync()`. A spec that needs the OTHER branch (an existing path, or a throw) calls
// `chromium.executablePath.mockReturnValue(...)` (or `.mockImplementation(...)`) itself, same as it
// would for `launch`.
const DEFAULT_EXECUTABLE_PATH = '/mock/does-not-exist/chromium-1243/chrome-linux64/chrome';

function freshChromium() {
  return {
    launch: vi.fn().mockImplementation(async () => createBrowser(true)),
    executablePath: vi.fn().mockReturnValue(DEFAULT_EXECUTABLE_PATH),
  };
}

// Reassigned wholesale by `__mock.reset()` below — see that call's own comment.
export let chromium = freshChromium();

/**
 * Test-only controls, namespaced so they can never be mistaken for the real `playwright-core` API —
 * `render-pdf.ts` itself only ever touches `chromium` above.
 */
export const __mock = {
  get pages(): readonly MockPage[] {
    return pages;
  },
  get browsers(): readonly MockBrowser[] {
    return browsers;
  },
  get maxOpenPages(): number {
    return maxOpenPages;
  },
  setPdfDelayMs(ms: number): void {
    pdfDelayMs = ms;
  },
  /** The next (and only the next) `page.pdf()` call rejects with `error` instead of resolving. */
  failNextPdf(error: Error): void {
    nextPdfError = error;
  },
  /**
   * Restores this whole mock to its just-loaded state: empty `pages`/`browsers`, zeroed counters, and
   * a brand new `chromium` (fresh `vi.fn()`s, zero call history, the DEFAULT `executablePath`).
   *
   * Needed because — unlike Jest, where `jest.resetModules()` genuinely re-executed this file (a fresh
   * manual mock, a fresh module top-level) on every `require('playwright-core')` after it —
   * Vitest keeps a `vi.mock(id, factory)` factory's own produced module alive across
   * `vi.resetModules()` calls (measured while converting this file: `resetModules()` correctly forces
   * a fresh `render-pdf.ts`/`validate-schematron.ts` re-evaluation, since those are ordinary project
   * modules, but this manual mock's OWN module-level `pages`/`browsers` arrays and `chromium.launch`'s
   * call history kept accumulating test-to-test regardless). `render-pdf.spec.ts`'s own `beforeEach`
   * calls this explicitly to restore the equivalent-to-Jest "every test starts from a clean mock" state.
   */
  reset(): void {
    pages.length = 0;
    browsers.length = 0;
    openPages = 0;
    maxOpenPages = 0;
    pdfDelayMs = 0;
    nextPdfError = null;
    chromium = freshChromium();
  },
};
