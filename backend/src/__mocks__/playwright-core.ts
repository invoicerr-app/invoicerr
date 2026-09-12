/**
 * Manual mock for the small slice of `playwright-core` that `rendering/render-pdf.ts` actually
 * touches: `chromium.launch()`, and the `Browser`/`Page` methods it calls on what that returns.
 *
 * Lives under `backend/src/__mocks__/` (NOT a root-level `__mocks__/`) because this project's jest
 * config sets `rootDir: "src"` — Jest looks for a node-module manual mock adjacent to each configured
 * `root`, and `src` is the only one here. Unlike a mock colocated next to a first-party module (which
 * needs an explicit `jest.mock('./local-module')` per spec), a manual mock for a `node_modules`
 * package like this one is wired in AUTOMATICALLY for every test in the project once this file exists
 * — confirmed by hand while writing `render-pdf.spec.ts`: an early draft of its "real render" smoke
 * check returned THIS mock's fake buffer with no `jest.mock('playwright-core')` call anywhere, and
 * only came back with a real PDF after an explicit `jest.unmock('playwright-core')`. `render-pdf.spec.ts`
 * still calls `jest.mock('playwright-core')` itself, for a reader's sake — it documents the dependency
 * at the call site instead of relying on this file's mere existence being obvious — but the mock would
 * be active either way, which is worth knowing before assuming some OTHER spec's `playwright-core`
 * import is exercising the real package.
 *
 * Deliberately fakes a whole browser/page pair rather than stubbing `renderPdf` itself: the specs this
 * mock exists for (the launch mutex, the concurrency cap, "page closed but browser kept alive on
 * error") are all about how `render-pdf.ts` sequences calls onto `chromium`/`Browser`/`Page` — stubbing
 * `renderPdf` would test nothing.
 */

type MockPage = {
  setContent: jest.Mock<Promise<void>, [string, unknown?]>;
  pdf: jest.Mock<Promise<Buffer>, [unknown?]>;
  close: jest.Mock<Promise<void>, []>;
};

type MockBrowser = {
  isConnected: jest.Mock<boolean, []>;
  newPage: jest.Mock<Promise<MockPage>, []>;
  close: jest.Mock<Promise<void>, []>;
};

/** Every page/browser this mock has ever handed out, in creation order — specs read these directly
 *  instead of digging through jest's own `.mock.results`, so a spec reads as "the second page" rather
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
    setContent: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockImplementation(async () => {
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
    close: jest.fn().mockImplementation(async () => {
      openPages--;
    }),
  };
  pages.push(page);
  return page;
}

function createBrowser(connected = true): MockBrowser {
  const browser: MockBrowser = {
    isConnected: jest.fn().mockReturnValue(connected),
    newPage: jest.fn().mockImplementation(async () => {
      openPages++;
      maxOpenPages = Math.max(maxOpenPages, openPages);
      return createPage();
    }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  browsers.push(browser);
  return browser;
}

export const chromium = {
  launch: jest.fn().mockImplementation(async () => createBrowser(true)),
};

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
};
