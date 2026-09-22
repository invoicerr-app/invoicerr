/**
 * The FALLBACK HTTP call this feature makes — a free, no-key GET against open.er-api.com
 * ("Open Access" product of exchangerate-api.com), consulted ONLY for a currency
 * `ecb-rates-client.ts`'s feed does not quote (the ECB publishes ~29 currencies against EUR; this
 * feed publishes ~160). Same "provider client is a plain async function, no Nest DI, no Prisma"
 * shape `ecb-rates-client.ts` already holds, so `currency-rate-sweep-runner.ts` can mock it with a
 * single `jest.mock('./open-er-api-rates-client')`.
 *
 * ## Why this exists at all, and why it is a fallback, never a replacement
 * The ECB stays the sole source for every currency it quotes: it is the reference the tax
 * authorities of this product's five countries (FR/PL/IT/PT/DE) publish against, and no aggregator
 * matches that on a legal document. This feed only ever fills a gap the ECB leaves open — see
 * `currency-rate-sweep-runner.ts#runSweep` for exactly where it is consulted (lazily, only when the
 * ECB's own map is missing a currency a pair needs) and `currency-rate-sweep.ts`'s
 * `EXCHANGERATE_API_SOURCE` for why a row this feed produced is NEVER stamped `source: 'ecb'`.
 *
 * ## Licence — the three obligations this file and its caller together honour
 * Fetched verbatim from https://www.exchangerate-api.com/docs/free on 2026-09-14: "This open access
 * API is subject to our Terms and requires attribution. You're welcome to cache the data we respond
 * with and to use it for either personal or commercial currency conversion purposes. You are,
 * however, not allowed to re-distribute it."
 *   - Attribute: the currency settings screen (`CurrencyRatesSettings`, frontend), never the invoice
 *     PDF — the product owner's own placement decision, because an invoice is a legal document to a
 *     third party, not a screen this provider's terms are aimed at.
 *   - Never re-distribute the RAW feed: only the single computed cross-rate a company's own pair
 *     actually needs is ever persisted (`currency-rate-sweep-runner.ts`) — the ~160-currency response
 *     body itself is parsed in memory and discarded, never stored or exposed wholesale.
 *   - Commercial use: explicitly granted by the same clause.
 *   Caching (the existing `CurrencyRate` table, already built for the ECB source) is explicitly
 *   permitted by the same clause — this file adds no new caching mechanism.
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

/** The subset of the feed's actual JSON body this parser reads — verified live, 2026-09-14, against
 *  a real `GET https://open.er-api.com/v6/latest/EUR`. The body also carries `provider`,
 *  `documentation`, `terms_of_use`, `time_last_update_utc`/`time_next_update_utc` and
 *  `time_last_update_unix`/`time_next_update_unix` — informational fields this parser has no use for
 *  (the sweep dates every row it writes off the ECB's own `referenceDate`, for both sources alike, so
 *  a second, possibly differently-timed "last updated" stamp from this feed would only invite the two
 *  sources' rows to disagree about what day they're for). */
interface OpenErApiResponseBody {
  /** `'success'` or `'error'` — THE actual success signal. This endpoint answers HTTP 200 even for
   *  its OWN errors (an unsupported base code, a tripped rate limit): verified live, 2026-09-14,
   *  `GET .../v6/latest/XXXX` -> HTTP 200, body `{"result":"error","error-type":"unsupported-code"}`.
   *  `response.ok` alone is therefore not enough to trust the body below. */
  result?: string;
  'error-type'?: string;
  base_code?: string;
  rates?: Record<string, number>;
}

/**
 * Fetches and parses `open.er-api.com`'s EUR-based latest-rates response. Never returns a
 * half-empty result: an HTTP-level failure, the feed's own `result: 'error'`, a missing/empty
 * `rates` object, or an unexpected base currency all throw a named Error rather than silently
 * handing the caller an empty/partial map — the same discipline
 * `ecb-rates-client.ts#fetchEcbDailyRates` holds, so `currency-rate-sweep-runner.ts`'s ONE call site
 * treats any throw from this function exactly like an ECB failure: this pass's fallback simply isn't
 * available, never a crash.
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
