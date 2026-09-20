/**
 * Pays the PDF renderer's one-time cold start in a spec's `beforeAll`, so that the per-document
 * liveness budgets in this directory ("the worker consumed the job and wrote the status within
 * 20 s") measure the queue round-trip they were written to measure, and not a browser launch.
 *
 * ## Why this exists — the numbers
 *
 * `render-pdf.ts` launches ONE headless Chromium lazily, on the first `renderPdf()` call of the
 * process, and keeps it for the process's whole life. Every send in these specs renders a real PDF,
 * so whichever job happens to be first pays that launch inside whatever the caller is timing.
 *
 * On a developer machine the launch is invisible: measured here at 131 ms, and 277 ms even with the
 * whole Chromium install (303 files) evicted from the page cache first. On a GitHub-hosted runner it
 * is neither small nor stable. Reading the FIRST send and a LATER send of the same
 * `document-action-queue.redis.spec.ts` process out of 23 consecutive `queue-integration` runs:
 *
 *   later send (browser already up):  563, 569, 570, 595, 610, 822, 824, 825, 829, 832, 835, 837 ms
 *   first send (browser launching):   1587, 1604, 2093, 9398, 10022, 10168, 10182, 10392, 10407,
 *                                     11912, 12434, 12531, 14180, 14199, 18443, 19743 ms — and six
 *                                     runs where it had still not settled at the 20 000 ms deadline
 *
 * The later send is always under a second; the first one is the same work plus the launch, and that
 * launch ranges from ~1 s to over 30 s on the same runner image. The spread is the runner's own
 * cold-disk and first-run cost — the binary `/usr/bin/chromium` points at is a ~170 MB unpacked
 * Chromium snapshot that nothing on the runner has touched yet — not anything this repository
 * controls, and not anything the assertion under test is about.
 *
 * That the cost is machine-wide and one-time (not per-process, and not "the first job a fresh BullMQ
 * worker picks up") is what the other specs in this directory show: in the SAME job,
 * `document-conformity-queue.redis.spec.ts` and `document-schedule-queue.redis.spec.ts` each boot
 * their own worker in their own forked process, and their own first job settles in 364 ms and
 * 1263 ms — including, for the schedule spec, a full send that renders and mails a real PDF in
 * 786 ms. They are cheap because they run AFTER the spec that already warmed the machine up.
 *
 * ## Why warming rather than a longer deadline
 *
 * Raising the deadline would keep the browser launch inside the number being asserted, so the
 * assertion would go on meaning "queue round-trip OR browser launch, whichever we got", and the next
 * slow runner would move the failure rather than remove it. Warming here leaves the 20 s bound
 * exactly as strict about the thing it names.
 *
 * The production instance pays this same cold start on its first PDF after a boot; that is a
 * property of the lazy launch in `render-pdf.ts`, deliberately left alone here — a test helper is no
 * place to change when the server starts a browser.
 *
 * A host with no usable Chromium at all makes this throw `PDF renderer unavailable: …` out of
 * `beforeAll`, naming the missing binary, instead of letting every send in the file time out with a
 * status-never-settled message that points at the queue.
 */
import { renderPdf } from '../../rendering/render-pdf';

/** Self-contained, deliberately trivial — the point is to launch the browser and open one page, not
 *  to exercise any of `render-html.ts`'s real output. */
const WARMUP_HTML = '<html><body><p>warm-up</p></body></html>';

/**
 * Renders one throwaway PDF, leaving `render-pdf.ts`'s shared browser up for the rest of the
 * process, and prints what that cost — so a runner that takes twenty seconds to start a browser says
 * so in its own output, instead of the cost resurfacing as an unexplained timeout somewhere else.
 *
 * Written straight to the stream rather than through `console.*`: Vitest INTERCEPTS console calls
 * and its default reporter (the one CI runs) drops the ones a `beforeAll` makes, so a
 * `console.error` here is visible only under `--reporter=verbose` — measured, not assumed. A direct
 * `process.stderr.write` is not intercepted and prints under every reporter, which is exactly how
 * the Nest logger's own lines reach these same CI logs.
 */
export async function warmUpPdfRenderer(): Promise<void> {
  const startedAt = Date.now();
  await renderPdf(WARMUP_HTML);
  process.stderr.write(`[queue-test] PDF renderer warm-up took ${Date.now() - startedAt}ms\n`);
}
