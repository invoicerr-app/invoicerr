import { existsSync } from 'node:fs';

import { Browser, chromium, Page } from 'playwright-core';

import { logger } from '@/logger/logger.service';

/**
 * HTML->PDF rendering, on `playwright-core` (NOT the full `playwright` package — that one downloads
 * its own browsers on install, hundreds of MB the runtime image doesn't need since it already ships
 * a Chromium; `playwright-core` bundles none and expects the caller to point it at one, see
 * `resolveChromiumExecutablePath` below). `playwright-core` ships a CommonJS build, which matters
 * here specifically: this repo's jest runs `ts-jest` in CJS mode, and `puppeteer` 25+ is pure ESM —
 * merely importing puppeteer 25 would fail to load at module scope, and the import chain
 * `documents.controller -> render-instance-pdf -> render-pdf` drags that import into most of the
 * document test tree. Staying on `playwright-core` (rather than bumping puppeteer, which is why it
 * was pinned at ^24.43.1) keeps that whole tree loadable under the test runner we actually have.
 */

/**
 * Shared browser instance — launched lazily on first call, never closed between renders.
 * Multiple pages are created per render and closed after PDF generation.
 */
let browserInstance: Browser | null = null;

/**
 * The in-flight launch, while one is happening — the mutex that closes a real race: without it, two
 * concurrent FIRST renders both observe `browserInstance === null`, and each calls `chromium.launch()`
 * of its own accord. Only the second launch's result ever gets assigned to `browserInstance` (the
 * first assignment is simply overwritten); the first browser process is never referenced again, so
 * nothing ever calls `.close()` on it — it leaks for the entire remaining lifetime of the process.
 * Every caller that arrives while a launch is already running instead awaits THIS promise, so exactly
 * one browser is ever launched for any burst of concurrent first calls. Cleared in `finally` once the
 * launch settles (success or failure) so a transient launch failure doesn't permanently wedge every
 * future render behind one rejected promise — the next call gets a fresh attempt.
 */
let launchPromise: Promise<Browser> | null = null;

/**
 * Conventional install locations for a system Chromium/Chrome, checked in this fixed order only
 * after both env-var overrides below have already come up empty. These are the paths Debian/Ubuntu
 * (`chromium`, `chromium-browser`) and Google's own `.deb` (`google-chrome`, `google-chrome-stable`)
 * packages install to — covering an operator who never set either env var but does have a system
 * browser (e.g. the base image this repo ships, `ghcr.io/invoicerr-app/server-image` — see the root
 * Dockerfile).
 */
const CONVENTIONAL_CHROMIUM_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

/**
 * Resolves which Chromium binary to launch, logging (at debug level) which rule matched. Throws a
 * named, actionable error rather than ever launching with no `executablePath` at all — that would
 * make `playwright-core` search for its OWN bundled browser, which this package deliberately does
 * not ship (see this file's module comment), producing a confusing low-level "browser not found at
 * .cache/ms-playwright/..." error instead of one that names the actual fix. This repo's own
 * discipline for an unresolvable configuration is a named failure over a silent fallback — the same
 * choice `ocr-server.ts` makes for a typo'd `OCR_ENGINE` (a named 501, never a silently-guessed
 * engine) — and a PDF renderer that returned an empty or broken buffer instead would be worse than
 * an explicit error, not better.
 *
 * Order matters:
 *  1. `CHROMIUM_EXECUTABLE_PATH` — the current, explicit setting for this engine.
 *  2. `PUPPETEER_EXECUTABLE_PATH` — a backward-compatibility alias, not dead code. Self-hosted
 *     operators run this image with their own compose files and env, set back when puppeteer was the
 *     engine (`Dockerfile` used to export exactly this var). Dropping this branch on an engine swap
 *     would silently break their PDFs on the next image pull, with no diagnostic pointing at why —
 *     so it keeps being honoured for as long as puppeteer's name might still appear in someone's env.
 *  3. The conventional system paths above.
 */
function resolveChromiumExecutablePath(): string {
  const explicit = process.env.CHROMIUM_EXECUTABLE_PATH;
  if (explicit) {
    logger.debug('Chromium resolved via CHROMIUM_EXECUTABLE_PATH', {
      category: 'documents',
      details: { path: explicit },
    });
    return explicit;
  }

  // Backward-compatibility alias — see this function's own header. Keep honouring it.
  const legacy = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (legacy) {
    logger.debug('Chromium resolved via legacy PUPPETEER_EXECUTABLE_PATH', {
      category: 'documents',
      details: { path: legacy },
    });
    return legacy;
  }

  for (const candidate of CONVENTIONAL_CHROMIUM_PATHS) {
    if (existsSync(candidate)) {
      logger.debug('Chromium resolved via conventional system path', {
        category: 'documents',
        details: { path: candidate },
      });
      return candidate;
    }
  }

  throw new Error(
    'PDF renderer unavailable: no Chromium executable found. Set CHROMIUM_EXECUTABLE_PATH (or the ' +
      'legacy PUPPETEER_EXECUTABLE_PATH) to a Chromium/Chrome binary, or install one at one of the ' +
      `conventional paths (${CONVENTIONAL_CHROMIUM_PATHS.join(', ')}).`,
  );
}

/**
 * Bounds how many renders run at once — recorded finding in this repo's own security audit
 * (`SECURITY_AUDIT.md`, "no dedicated rate-limit on expensive operations"): PDF rendering shares ONE
 * browser process for the whole instance, and every render holds a real Chromium page (a renderer
 * process plus its own memory) open for the duration of `page.pdf()`. With no cap, a single
 * authenticated account — well within the normal global request throttle — can already push well
 * over a hundred concurrent renders, and because the browser is shared, a spike from one company
 * degrades PDF rendering for every other company on the same instance (self-host or SaaS). Rather
 * than rejecting a caller outright once the cap is hit, `acquireRenderSlot` queues them: a burst is
 * throttled to this many renders in flight, not failed.
 *
 * Configurable via `PDF_RENDER_CONCURRENCY` for an operator who genuinely has the memory (and the
 * volume) to raise it, or who wants it lower on a constrained box. Garbage or non-positive input
 * (an empty/unset var included) falls back to the default rather than producing `NaN` or `0` — a
 * `NaN` limit would make the `<` comparison below always false, so every render would queue forever
 * and none would ever run: a misconfiguration must degrade to "the default limit", never to a silent
 * full deadlock of PDF rendering.
 */
function readMaxConcurrentRenders(): number {
  const DEFAULT_MAX_CONCURRENT_RENDERS = 4;
  const parsed = parseInt(process.env.PDF_RENDER_CONCURRENCY ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_RENDERS;
}

const MAX_CONCURRENT_RENDERS = readMaxConcurrentRenders();

/** How many renders currently hold a slot (i.e. have an open page between `newPage()` and `close()`). */
let activeRenders = 0;
/** FIFO of renders waiting for a slot — resolved one at a time as slots free up, in arrival order. */
const renderQueue: Array<() => void> = [];

/**
 * Reserves one of the `MAX_CONCURRENT_RENDERS` slots, waiting in FIFO order if none is free right
 * now. Always paired with `releaseRenderSlot()` in the `finally` of `renderPdf` below, so a slot is
 * freed (and the next queued render admitted) even when the render itself throws.
 */
function acquireRenderSlot(): Promise<void> {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    renderQueue.push(() => {
      activeRenders++;
      resolve();
    });
  });
}

function releaseRenderSlot(): void {
  activeRenders--;
  const next = renderQueue.shift();
  if (next) next();
}

/**
 * Initializes the shared browser instance. Throws with a clear message if launch fails.
 */
async function getBrowser(): Promise<Browser> {
  if (browserInstance?.isConnected()) {
    return browserInstance;
  }

  // A launch is already under way (this is the second-or-later concurrent caller) — wait for THAT
  // one instead of starting a second browser. See `launchPromise`'s own header above.
  if (launchPromise) {
    return launchPromise;
  }

  launchPromise = launchBrowser();
  try {
    browserInstance = await launchPromise;
    return browserInstance;
  } finally {
    // Whether launchBrowser() resolved or rejected, this launch is no longer "in flight" — the next
    // call (a retry after a failure, or the next disconnect) must be able to start a fresh one.
    launchPromise = null;
  }
}

async function launchBrowser(): Promise<Browser> {
  // Resolved BEFORE the try/catch below on purpose: "no Chromium found" is a distinct, actionable
  // configuration error, not a launch failure — it must reach the caller with its own named message
  // intact, not get re-wrapped into the generic "could not be launched" text below.
  const executablePath = resolveChromiumExecutablePath();

  try {
    const browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox'],
    });
    logger.debug('PDF renderer browser launched', { category: 'documents', details: { executablePath } });
    return browser;
  } catch (error) {
    logger.error('PDF renderer browser launch failed', {
      category: 'documents',
      details: { message: error instanceof Error ? error.message : String(error) },
    });
    throw new Error(
      `PDF renderer unavailable: Chrome/Chromium could not be launched. ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Renders HTML to PDF buffer using a shared headless Chromium (via Playwright). Throws if the PDF
 * engine fails.
 */
export async function renderPdf(html: string): Promise<Buffer> {
  await acquireRenderSlot();

  let page: Page | null = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    // Every document this renderer receives is fully self-contained HTML: `render-html.ts` inlines
    // all CSS directly, and the one embedded image (the SEPA payment QR, `sepa-qr.ts`) arrives as a
    // base64 `data:image/png;...` URI, not a URL. There is no external network fetch this page could
    // ever wait on, so `networkidle` would only add latency waiting for network activity that never
    // starts — `domcontentloaded` (the DOM finished parsing) is already the point at which everything
    // this page will ever render is present.
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      // Puppeteer's `page.pdf()` applied a ~1cm margin on every side by default; Playwright's own
      // default is ZERO on every side. `render-html.ts`'s CSS declares no `@page` rule and no print
      // margin of its own, so this explicit block is the ONLY thing producing the printable gutter —
      // omitting it (e.g. to "simplify" what looks like a redundant default) would silently reflow
      // every invoice, quote, receipt and credit note this product generates to the paper's edge.
      margin: { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' },
    });

    return Buffer.from(pdfBuffer);
  } catch (error) {
    logger.error('PDF rendering failed', {
      category: 'documents',
      details: { message: error instanceof Error ? error.message : String(error) },
    });
    if (error instanceof Error && error.message.includes('PDF renderer unavailable')) {
      throw error;
    }
    throw new Error(`PDF rendering failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  } finally {
    // Always close the page, but never close the browser (shared instance)
    if (page) {
      try {
        await page.close();
      } catch (closeError) {
        logger.debug('Page close error (non-fatal)', {
          category: 'documents',
          details: { message: closeError instanceof Error ? closeError.message : String(closeError) },
        });
      }
    }
    releaseRenderSlot();
  }
}
