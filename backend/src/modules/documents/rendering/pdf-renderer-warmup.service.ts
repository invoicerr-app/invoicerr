/**
 * Starts the PDF renderer's headless Chromium at boot, so no user is the one who pays for it.
 *
 * `render-pdf.ts` launches ONE browser lazily, on the first `renderPdf()` call, and keeps it for the
 * life of the process — which means the first PDF after every deploy absorbs the whole launch inside
 * whatever asked for it. On a shared runner that has been measured at anywhere from 1.5 s to over
 * 30 s (`warmUpPdfRenderer`'s own header carries the numbers). This service moves that cost to
 * startup, where a deployment waits instead of a customer.
 *
 * ## Why it is registered in `DocumentsCoreModule`
 *
 * That module is loaded by exactly the processes that can render a PDF, and by nothing else:
 *  - the dedicated `ROLE=worker` process (worker.ts), which renders every queued send;
 *  - the API process, which renders SYNCHRONOUSLY, inside the request, for `GET /documents/:id/pdf`
 *    (documents.controller.ts), the public share link (public/public-documents.controller.ts), the
 *    client portal (modules/client-portal/portal.service.ts), the signature freeze
 *    (signatures/signatures.service.ts) and the billing ZIP export (modules/billing/export-zip.service.ts).
 *
 * None of those API paths is gated on `WORKER_INLINE`. Registering this on
 * `DocumentsQueueWorkerModule` instead would have looked narrower — it is the module `WORKER_INLINE`
 * actually gates — but it would have left a `WORKER_INLINE=false` API, i.e. the scaled topology where
 * the API is the only process a browser-facing user ever talks to, still cold-starting Chromium in
 * the middle of somebody's own invoice download: the exact wait this service exists to remove. A
 * process that loads neither module never constructs this class, so it never starts a browser it
 * would not have used.
 *
 * ## Why it does not block startup
 *
 * `onApplicationBootstrap` returns `void`, not the promise — Nest therefore awaits nothing and the
 * rest of the boot continues while the browser comes up behind it. That is not a stylistic
 * preference: the worker's readiness signal is the health server worker.ts binds on :3001, and it
 * binds it only AFTER `app.init()` has returned. The chart gives that probe
 * `initialDelaySeconds: 10` plus three ten-second periods before it reports unready, and the
 * liveness probe on the same port twenty seconds plus six fifteen-second periods before it KILLS the
 * pod (deploy/helm/invoicerr/values.yaml). A 30-second launch awaited inside `init()` would spend
 * most of the readiness budget and push the worst case into the liveness one — turning "this
 * machine is slow to start a browser" into "Kubernetes restarts the pod", which renders nothing at
 * all and then starts the same slow launch over again. Running alongside costs nothing in return:
 * `getBrowser()`'s own launch mutex (`launchPromise`, render-pdf.ts) means a render arriving while
 * the warm-up is still in flight simply awaits the SAME launch rather than starting a second browser.
 *
 * ## Why a failed warm-up is not fatal
 *
 * `playwright-core` ships no browser of its own, so there is no Chromium to resolve at all on a
 * developer checkout that never set `CHROMIUM_EXECUTABLE_PATH`, nor on a self-hosted image built
 * without one — `resolveChromiumExecutablePath` (render-pdf.ts) throws by design in that case, with a
 * message naming the fix. Letting that throw escape here would trade "the first PDF is slow" for
 * "the server does not start", on every such machine, which is strictly the worse trade: PDF
 * rendering is one feature, booting is all of them. So the failure is logged as a warning that says
 * what is now going to be slow and why, and the boot carries on. Nothing else changes — the first
 * render then fails exactly as it does today, with `render-pdf.ts`'s own named error, neither better
 * nor worse off for the warm-up having been attempted.
 */
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { warmUpPdfRenderer } from './render-pdf';

@Injectable()
export class PdfRendererWarmupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PdfRendererWarmupService.name);

  /**
   * The warm-up itself, once bootstrap has started it — settled (never rejected, see `runWarmUp`)
   * whether the browser came up or not. Exposed so a test can await the work this service
   * deliberately does NOT make the framework await; nothing in production reads it.
   */
  warmUp: Promise<void> = Promise.resolve();

  onApplicationBootstrap(): void {
    // Intentionally not returned: returning the promise is what would make Nest await it, and this
    // must not delay the health server worker.ts binds after `init()`. See this file's own header.
    this.warmUp = this.runWarmUp();
  }

  private async runWarmUp(): Promise<void> {
    const startedAt = Date.now();
    try {
      await warmUpPdfRenderer();
      this.logger.log(`PDF renderer warmed up in ${Date.now() - startedAt}ms — Chromium is ready.`);
    } catch (error) {
      // Swallowed on purpose — see this file's header on why a machine with no browser must still
      // boot. The message names the consequence, not just the error, because an operator reading
      // startup logs needs to know WHAT is now slow, not merely that something failed.
      this.logger.warn(
        `PDF renderer could not be warmed up at startup, so the first PDF of this process will pay ` +
          `the Chromium launch itself (seconds, not milliseconds) — and will fail outright if no ` +
          `browser can be found by then: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
