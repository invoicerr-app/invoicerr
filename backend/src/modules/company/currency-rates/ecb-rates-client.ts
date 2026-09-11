/**
 * The one HTTP call this feature makes — a free, no-key GET against the European Central Bank's
 * daily reference-rates feed (item 9, root TODO — "le multi-devises", automatic leg). Kept as a
 * standalone client (no Nest DI, no Prisma) so `currency-rate-sweep-runner.ts` can mock it with a
 * single `jest.mock('./ecb-rates-client')`, the same "provider client is a plain async function"
 * shape `transports/*-client.ts` already holds throughout this codebase.
 *
 * This URL is FIXED, ECB-owned, and never influenced by user input — unlike an operator-supplied
 * webhook destination (`webhooks/url-guard.ts`), there is no SSRF surface here to guard against, so
 * this deliberately does NOT go through that guard.
 */
import { DOMParser, Document as XmlDocument, Element as XmlElement } from '@xmldom/xmldom';

export const ECB_DAILY_RATES_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

/** Generous but bounded — a hung TLS handshake or a stalled response body must never leave the
 *  sweep (and therefore the whole BullMQ worker process, since nothing else runs on this thread
 *  while `fetch` awaits) blocked indefinitely. */
const FETCH_TIMEOUT_MS = 10_000;

export interface EcbDailyRates {
  /** The feed's own `<Cube time="...">` attribute, an ISO `YYYY-MM-DD` string — the business day
   *  these rates were fixed for, NOT necessarily "today" (the ECB does not publish on weekends/EU
   *  holidays, in which case the ~16:00 CET publication simply repeats the last business day's own
   *  date until the next one). Stored verbatim as `CurrencyRate.asOf` by the runner. */
  referenceDate: string;
  /** EVERY currency the feed quoted against EUR today, `ISO 4217 code -> "1 EUR is worth this many
   *  units of it"`. EUR itself is never a key — see `currency-rate-sweep.ts`'s own header on why
   *  every consumer must treat a missing EUR entry as "1", not as "not covered". */
  rates: Map<string, number>;
}

/**
 * Fetches and parses `eurofxref-daily.xml`. Never returns a half-empty result: a malformed
 * document, a missing dated cube, or a dated cube with zero currencies inside it all throw a named
 * Error rather than silently handing the caller an empty/partial map — see
 * `currency-rate-sweep-runner.ts#runSweep`'s own header for how the ONE call site treats any throw
 * from this function as "this pass could not refresh rates", never a crash.
 */
export async function fetchEcbDailyRates(): Promise<EcbDailyRates> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let xml: string;
  try {
    const response = await fetch(ECB_DAILY_RATES_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`ECB daily rates feed responded with HTTP ${response.status}`);
    }
    xml = await response.text();
  } finally {
    clearTimeout(timer);
  }
  return parseEcbDailyRates(xml);
}

/**
 * Pure parse, split out purely for readability — `ecb-rates-client.spec.ts` exercises it through
 * `fetchEcbDailyRates` (mocking `global.fetch`), the same "test through the one public entry point"
 * discipline `transports/sdi/xml-helpers.ts`'s own `parseXml` caller already holds, rather than a
 * second, independently-tested entry point for the parse alone.
 *
 * The feed nests THREE same-named `<Cube>` elements — envelope > one dated cube > one per currency
 * (see this file's own module header for the exact shape). Rather than assume that fixed nesting
 * depth, every `<Cube>` in the document (any namespace — `getElementsByTagNameNS('*', ...)`, the
 * identical "read by shape, not by prefix" defensiveness `xml-helpers.ts#firstByLocalName` already
 * holds for a different feed) is inspected for the attributes IT carries: one carries `time`, the
 * rest carry `currency`+`rate`. This is robust to the ECB ever changing element ORDER or adding a
 * wrapping level, which a positional `childNodes[0].childNodes[1]...` walk would not survive.
 */
function parseEcbDailyRates(xml: string): EcbDailyRates {
  const parseErrors: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, message: string) => {
      if (level === 'error' || level === 'fatalError') parseErrors.push(message);
    },
  });

  let doc: XmlDocument | undefined;
  try {
    doc = parser.parseFromString(xml, 'text/xml');
  } catch (err) {
    parseErrors.push(err instanceof Error ? err.message : String(err));
  }
  if (parseErrors.length > 0 || !doc?.documentElement) {
    throw new Error(
      `ECB daily rates feed returned malformed XML: ${parseErrors.join('; ') || 'no root element'}`,
    );
  }

  const cubes = doc.getElementsByTagNameNS('*', 'Cube');
  let referenceDate: string | undefined;
  const rates = new Map<string, number>();

  for (let i = 0; i < cubes.length; i++) {
    const cube: XmlElement | null = cubes.item(i);
    if (!cube) continue;

    const time = cube.getAttribute('time');
    if (time) referenceDate = time;

    const currency = cube.getAttribute('currency');
    const rateAttr = cube.getAttribute('rate');
    if (currency && rateAttr) {
      const rate = Number(rateAttr);
      if (Number.isFinite(rate)) rates.set(currency, rate);
    }
  }

  if (!referenceDate) {
    throw new Error('ECB daily rates feed had no dated <Cube time="..."> element.');
  }
  if (rates.size === 0) {
    throw new Error('ECB daily rates feed had a dated cube but no currency rates inside it.');
  }

  return { referenceDate, rates };
}
