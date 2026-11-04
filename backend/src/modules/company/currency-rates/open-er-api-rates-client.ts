/**
 * The fallback HTTP call: a free, keyless GET against open.er-api.com, consulted only for a currency
 * the ECB feed does not quote (~29 currencies against ~160). A plain async function with no DI, so the
 * runner can mock it.
 *
 * The ECB stays the sole source for everything it quotes, being the reference the tax authorities
 * publish against, so a row from this feed is never stamped `ecb`.
 *
 * Licence (https://www.exchangerate-api.com/docs/free): attribution is required, caching is allowed,
 * commercial use is explicitly granted and redistributing the feed is not. The settings screen carries
 * the attribution, never the invoice PDF; only the computed cross-rate is stored and the response body
 * is discarded.
 */

export const OPEN_ER_API_BASE_CURRENCY = 'EUR';
export const OPEN_ER_API_RATES_URL = `https://open.er-api.com/v6/latest/${OPEN_ER_API_BASE_CURRENCY}`;

/** Same bound and same reasoning as `ecb-rates-client.ts#FETCH_TIMEOUT_MS` — this call also happens
 *  on the BullMQ worker thread (`currency-rate-sweep-runner.ts`), and only ever AFTER the ECB call
 *  already succeeded, so a hang here must not be allowed to block the sweep indefinitely either. */
const FETCH_TIMEOUT_MS = 10_000;

export interface OpenErApiRates {
  /** `ISO 4217 code -> "1 EUR is worth this many units of it"` — the SAME shape
   *  `EcbDailyRates.rates` holds (`ecb-rates-client.ts`), so `currency-rate-sweep.ts#computeCrossRate`
   *  (written against that shape) is reused verbatim for this source too, never re-implemented.
   *  EUR itself is never a key, for the same reason: `computeCrossRate` never looks it up as one. */
  rates: Map<string, number>;
}

/** The subset of the feed's body this parser reads. The body also carries provider and timestamp
 *  fields it ignores: the sweep dates every row off the ECB reference date for both sources, so a
 *  second stamp would only invite the two to disagree. */
interface OpenErApiResponseBody {
  /** `'success'` or `'error'`, and the actual success signal: this endpoint answers HTTP 200 even for
   *  its own errors (an unsupported base code, a tripped rate limit), so `response.ok` is not enough. */
  result?: string;
  'error-type'?: string;
  base_code?: string;
  rates?: Record<string, number>;
}

/**
 * Fetches and parses the EUR-based latest rates. An HTTP failure, the feed's own `result: 'error'`, a
 * missing or empty `rates` object or an unexpected base all throw a named error rather than returning a
 * partial map, so the caller treats a throw like an ECB failure and skips the fallback this pass.
 */
export async function fetchOpenErApiRates(): Promise<OpenErApiRates> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let body: OpenErApiResponseBody;
  try {
    const response = await fetch(OPEN_ER_API_RATES_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`open.er-api.com rates feed responded with HTTP ${response.status}`);
    }
    body = (await response.json()) as OpenErApiResponseBody;
  } finally {
    clearTimeout(timer);
  }
  return parseOpenErApiRates(body);
}

/** Pure parse, split out purely for readability — the same "test through the one public entry point"
 *  discipline `ecb-rates-client.ts#parseEcbDailyRates` already holds; `open-er-api-rates-client.spec.ts`
 *  exercises this through `fetchOpenErApiRates` (mocking `global.fetch`), never this function directly. */
function parseOpenErApiRates(body: OpenErApiResponseBody): OpenErApiRates {
  if (body.result !== 'success') {
    const detail = body['error-type'] ? `: ${body['error-type']}` : '';
    throw new Error(`open.er-api.com rates feed returned a non-success result${detail}.`);
  }
  if (body.base_code !== OPEN_ER_API_BASE_CURRENCY) {
    // Guards the composition math below (`computeCrossRate`'s EUR-based assumptions), not just this
    // parse — the URL fixes the base to EUR already, so this only ever fires if the feed itself
    // starts answering a different base than the one actually requested.
    throw new Error(
      `open.er-api.com rates feed had base_code "${body.base_code ?? 'undefined'}", expected "${OPEN_ER_API_BASE_CURRENCY}".`,
    );
  }
  if (!body.rates || typeof body.rates !== 'object') {
    throw new Error('open.er-api.com rates feed had no "rates" object.');
  }

  const rates = new Map<string, number>();
  for (const [code, value] of Object.entries(body.rates)) {
    if (code === OPEN_ER_API_BASE_CURRENCY) continue; // never a key of its own — see this file's OpenErApiRates comment
    if (typeof value === 'number' && Number.isFinite(value)) rates.set(code, value);
  }

  if (rates.size === 0) {
    throw new Error(
      'open.er-api.com rates feed had a "rates" object but no usable currency rates inside it.',
    );
  }

  return { rates };
}
