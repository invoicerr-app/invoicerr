// Latency targets for every named request of scenario.js, shared by the k6 thresholds (which make
// `k6 run` exit non-zero on a breach) and by report.js (which prints pass or fail per request).
// Plain JavaScript with no imports, so k6 and Node both load it.
//
// Every request is judged on its own: an overall p95 can sit well under target while one step that
// runs once per loop (the send, say) is far above it.

export const STEPS = [
  'login',
  'session',
  'company_info',
  'dashboard',
  'list_quotes',
  'list_invoices',
  'list_clients',
  'quote_create',
  'quote_convert',
  'invoice_pdf',
  'invoice_send',
  'poll_invoice',
  'ocr_upload',
  'poll_ocr',
];

const DEFAULT_TARGET = { p95: 500, p99: 1000 };

// The draft PDF is a synchronous Chromium render in the api process; its own, looser target is
// tracked with its speed-up separately.
const OWN_TARGETS = { invoice_pdf: { p95: 2000, p99: 4000 } };

export function targetFor(step) {
  return OWN_TARGETS[step] ?? DEFAULT_TARGET;
}

/** The `thresholds` block of the k6 options: p95 and p99 per named request. */
export function k6Thresholds() {
  return Object.fromEntries(
    STEPS.map((step) => {
      const { p95, p99 } = targetFor(step);
      return [`http_req_duration{name:${step}}`, [`p(95)<${p95}`, `p(99)<${p99}`]];
    }),
  );
}

/**
 * Pass or fail for one step's measured p95 and p99, in milliseconds, against its target. A step
 * with no sample (OCR when the run has no scan) has nothing to judge, as k6 itself treats it.
 */
export function verdict(step, measured) {
  if (!measured || measured.count === 0 || measured.p95 === undefined || measured.p99 === undefined) return null;
  const { p95, p99 } = targetFor(step);
  return measured.p95 < p95 && measured.p99 < p99 ? 'pass' : 'fail';
}
