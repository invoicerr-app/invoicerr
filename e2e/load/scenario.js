// k6 scenario: one virtual user = one person invoicing without pause.
//
//   k6 run -e BASE=http://<host> -e USERS=users.json -e VUS=10 -e DURATION=5m scenario.js
//
// Each VU takes its own seeded user (seed.mjs) and its session, then loops: dashboard, the three
// lists, a 5-line quote converted to an invoice, the invoice's PDF rendered while still a draft
// (Chromium in the api pod), then sent (numbering + Chromium again in a worker + e-mail), polled
// until `sent`. Every 5th loop also uploads a scanned supplier invoice for OCR when SCAN is set.
import http from 'k6/http';
import { check, fail, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE;
const users = JSON.parse(open(__ENV.USERS || 'users.json'));
const scan = __ENV.SCAN ? open(__ENV.SCAN, 'b') : null;

export const options = {
  scenarios: {
    // ITERATIONS=n runs n loops per VU instead (smoke test).
    work: __ENV.ITERATIONS
      ? { executor: 'per-vu-iterations', vus: Number(__ENV.VUS || 1), iterations: Number(__ENV.ITERATIONS) }
      : { executor: 'constant-vus', vus: Number(__ENV.VUS || 1), duration: __ENV.DURATION || '5m', gracefulStop: '2m' },
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'],
  // k6 only exports a tagged sub-metric that carries a threshold; these always pass and exist so
  // --summary-export holds one latency line per step.
  thresholds: Object.fromEntries(
    [
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
    ].map((n) => [`http_req_duration{name:${n}}`, ['max>=0']]),
  ),
};

// Time from the "send" call returning to the worker having rendered, archived and mailed the
// invoice — the part the HTTP latencies cannot see, and the first to grow if workers saturate.
const sendToSent = new Trend('send_to_sent', true);
const sendFailed = new Counter('send_failed');
const sendTimedOut = new Counter('send_timed_out');
const throttled = new Counter('throttled_429');

let cookie = null;

function headers(extra) {
  // One X-Forwarded-For per VU: behind TRUST_PROXY_HOPS=2 it becomes the client IP Nest's
  // throttler keys on, so each VU gets its own 120/min bucket, as a distinct real user would.
  const vu = exec.vu.idInTest;
  const h = {
    origin: BASE,
    'x-forwarded-for': `100.64.${Math.floor(vu / 250)}.${(vu % 250) + 1}`,
    ...extra,
  };
  if (cookie) h.cookie = cookie;
  return h;
}

function track(res, step, expected = 200) {
  if (res.status === 429) throttled.add(1, { step });
  check(res, { [`${step} ${expected}`]: (r) => r.status === expected });
  return res;
}

function get(path, step) {
  return track(http.get(BASE + path, { headers: headers(), tags: { name: step } }), step);
}

function post(path, body, step, expected = 201) {
  const res = http.post(BASE + path, JSON.stringify(body), {
    headers: headers({ 'content-type': 'application/json' }),
    tags: { name: step },
  });
  return track(res, step, expected);
}

function action(typeId, actionId, body, step) {
  return post(`/api/documents/types/${typeId}/actions/${actionId}`, body, step);
}

function signIn(user) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = http.post(
      `${BASE}/api/auth/sign-in/email`,
      JSON.stringify({ email: user.email, password: user.password }),
      { headers: headers({ 'content-type': 'application/json' }), tags: { name: 'login' } },
    );
    if (res.status === 200) {
      // `__Secure-` cookie with the Secure flag: k6's jar will not replay it over http.
      const set = res.headers['Set-Cookie'] || '';
      const pair = set.split(/,(?=\s*[^;,]+=)/).find((c) => c.includes('session_token='));
      if (pair) return pair.split(';')[0].trim();
    }
    if (res.status === 429) throttled.add(1, { step: 'login' });
    sleep(2 + Math.random() * 3);
  }
  fail(`sign-in failed for ${user.email}`);
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

export default function () {
  const user = users[(exec.vu.idInTest - 1) % users.length];
  // Seeded sessions by default. Signing in is capped at 3 per 10 s for the whole instance (see
  // seed.mjs), so 50 VUs signing in at once would spend the stage's first minutes queuing on that
  // limiter instead of working. LOGIN=1 signs in anyway.
  if (!cookie) cookie = __ENV.LOGIN || !user.cookie ? signIn(user) : user.cookie;

  // 1. Dashboard, as the app shell and the dashboard page load it.
  get('/api/auth/get-session', 'session');
  get('/api/company/info', 'company_info');
  get('/api/documents/dashboard', 'dashboard');

  // 2. Lists.
  get('/api/documents?typeId=quote&page=1&pageSize=25', 'list_quotes');
  get('/api/documents?typeId=invoice&page=1&pageSize=25', 'list_invoices');
  get('/api/clients?page=1', 'list_clients');

  // 3. A 5-line quote, converted to an invoice.
  const client = user.clientIds[exec.scenario.iterationInTest % user.clientIds.length];
  const lines = [];
  for (let i = 0; i < 5; i++) {
    lines.push({
      description: `Line ${i + 1}`,
      quantity: 1 + i,
      unitPrice: 50 + 10 * i,
      vatRate: '19',
      unit: 'hour',
      articleId: user.articleIds[i % user.articleIds.length],
    });
  }
  const quoteData = { client, issueDate: today(), currency: 'EUR', lines };
  const quote = action('quote', 'save-draft', { data: quoteData }, 'quote_create');
  if (quote.status !== 201) return;
  const quoteId = quote.json('document.id');
  const conv = action('quote', 'convert-to-invoice', { documentId: quoteId, data: quoteData }, 'quote_convert');
  if (conv.status !== 201) return;
  const invoiceId = conv.json('document.id');
  const invoiceData = { ...conv.json('document.data'), dueDate: inDays(30), lines };

  // 4. The draft's PDF (synchronous render in the api pod), then send: number, worker render,
  // archive, e-mail to Mailpit. Poll until the worker is done.
  const pdf = get(`/api/documents/${invoiceId}/pdf?typeId=invoice`, 'invoice_pdf');
  check(pdf, { 'pdf is a PDF': (r) => r.status === 200 && String(r.body).startsWith('%PDF') });

  const send = action('invoice', 'send', { documentId: invoiceId, data: invoiceData }, 'invoice_send');
  if (send.status === 201) {
    const started = Date.now();
    let status = send.json('document.status');
    while (status === 'sending' && Date.now() - started < 180000) {
      sleep(1);
      const doc = get(`/api/documents/${invoiceId}?typeId=invoice`, 'poll_invoice');
      if (doc.status === 200) status = doc.json('status');
    }
    if (status === 'sent') sendToSent.add(Date.now() - started);
    else if (status === 'sending') sendTimedOut.add(1);
    else sendFailed.add(1);
    check(status, { 'invoice sent': (s) => s === 'sent' });
  }

  // 5. Every 5th loop: a scanned supplier invoice through OCR. Trailing bytes after %%EOF make each
  // upload a new file, or the duplicate-hash check answers 409 instead of running OCR.
  if (scan && exec.vu.iterationInScenario % 5 === 4) {
    const tail = `\n%${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Date.now()}\n`;
    const bytes = new Uint8Array(scan.byteLength + tail.length);
    bytes.set(new Uint8Array(scan));
    for (let i = 0; i < tail.length; i++) bytes[scan.byteLength + i] = tail.charCodeAt(i);
    const res = http.post(
      `${BASE}/api/documents/received-invoices/upload`,
      { file: http.file(bytes.buffer, 'scan.pdf', 'application/pdf') },
      { headers: headers(), tags: { name: 'ocr_upload' }, timeout: '180s' },
    );
    track(res, 'ocr_upload', 201);
  }
}
