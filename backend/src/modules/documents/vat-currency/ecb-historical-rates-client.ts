/**
 * Issue #517's own ECB client. DELIBERATELY separate from
 * `../../company/currency-rates/ecb-rates-client.ts`, which only ever fetches TODAY's daily reference
 * rate (one dated cube). This feature needs the rate for a SPECIFIC PAST date, an invoice's own
 * `issueDate`, which is very often "today" but is never guaranteed to be (a backdated correction, a
 * scheduled/recurring invoice generated a day late, a worker retry that runs after midnight), so it
 * reads the ECB's own HISTORICAL feed instead, which nests MANY dated cubes rather than one.
 *
 * Two endpoints, tried in order:
 *  - `eurofxref-hist-90d.xml`: the last ~90 calendar days, small (~15KB), covers every ordinary case
 *    (an invoice issued within the last three months, which is every invoice this codebase's own
 *    "send" preflight can ever reach; nothing here issues a document dated further in the past).
 *  - `eurofxref-hist.xml`: full history since 1999 (~500KB), fetched ONLY when the 90-day feed has no
 *    cube dated on or before the target date at all (a genuinely old backdated document, or the 90-day
 *    feed being briefly stale/unavailable). Never fetched on the ordinary path, so the common case
 *    stays cheap.
 *
 * Both feeds nest the SAME per-currency shape the daily feed's own `ecb-rates-client.ts` already
 * parses: one dated `<Cube time="...">` per business day, containing one `<Cube currency="..."
 * rate="...">` per quoted currency, just repeated many times instead of once. Parsed with the exact
 * same "any `<Cube>`, any namespace, inspected for the attributes IT carries" defensiveness that
 * file's own header explains, for the identical reason (robust to the ECB changing nesting/order).
 *
 * ECB quotes every rate as "how many units of X are worth 1 EUR", the OPPOSITE direction
 * `convert.ts#convertMinor` needs for converting a FOREIGN invoice currency INTO the national one
 * (EUR): `resolveEcbRateAsOf` inverts it (`1 / rate`) before returning, so every caller downstream
 * gets a rate directly usable as "EUR per 1 unit of the invoice's own currency", the same convention
 * `CurrencyRate.rate`/`DocumentPayment.conversionRate` already hold.
 */
import { DOMParser, Element as XmlElement } from '@xmldom/xmldom';

export const ECB_HISTORICAL_90D_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
export const ECB_HISTORICAL_FULL_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml';

const FETCH_TIMEOUT_MS = 10_000;

export interface EcbRateAsOf {
  /** EUR per 1 unit of the requested currency, already inverted, see this file's own header. */
  rate: number;
  /** The ECB business day this rate was actually published for: the latest one on or before the
   *  requested date, ISO `yyyy-mm-dd`. Never equal to the requested date itself when that date fell
   *  on a weekend/EU holiday the ECB does not publish for. */
  asOf: string;
}

async function fetchXml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`ECB historical rates feed (${url}) responded with HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/** One dated cube's worth of rates, `ISO currency -> "1 EUR is worth this many units"` (NOT yet
 *  inverted: inversion happens once, in `resolveEcbRateAsOf`, after the right cube is picked). */
type DatedCubes = Map<string, Map<string, number>>;

/**
 * Parses either historical feed into `date -> (currency -> rate)`. Pure, exported for
 * `ecb-historical-rates-client.spec.ts` to exercise directly against a small hand-built fixture,
 * mirroring `ecb-rates-client.ts#parseEcbDailyRates`'s own "parse split out purely for readability"
 * shape, but unlike that file, the tests here also go through this function directly rather than
 * only through the network-mocking entry point, since there is no single "the one public entry point"
 * this feature calls only once (two URLs, tried in order).
 */
export function parseEcbHistoricalRates(xml: string): DatedCubes {
  const parseErrors: string[] = [];
  const parser = new DOMParser({
    onError: (level: string, message: string) => {
      if (level === 'error' || level === 'fatalError') parseErrors.push(message);
    },
  });

  const doc = parser.parseFromString(xml, 'text/xml');
  if (parseErrors.length > 0 || !doc?.documentElement) {
    throw new Error(
      `ECB historical rates feed returned malformed XML: ${parseErrors.join('; ') || 'no root element'}`,
    );
  }

  const cubes = doc.getElementsByTagNameNS('*', 'Cube');
  const result: DatedCubes = new Map();
  let currentDate: string | undefined;

  for (let i = 0; i < cubes.length; i++) {
    const cube: XmlElement | null = cubes.item(i);
    if (!cube) continue;

    const time = cube.getAttribute('time');
    if (time) {
      currentDate = time;
      if (!result.has(currentDate)) result.set(currentDate, new Map());
      continue;
    }

    const currency = cube.getAttribute('currency');
    const rateAttr = cube.getAttribute('rate');
    if (currency && rateAttr && currentDate) {
      const rate = Number(rateAttr);
      if (Number.isFinite(rate)) result.get(currentDate)!.set(currency, rate);
    }
  }

  return result;
}

/** The latest dated cube at or before `dateIso` that actually quotes `currency`. `undefined` when
 *  no such cube exists anywhere in `cubes` (either the currency is never quoted by the ECB, or every
 *  cube in this particular feed postdates `dateIso`). */
function latestCubeOnOrBefore(cubes: DatedCubes, currency: string, dateIso: string): EcbRateAsOf | undefined {
  let best: { date: string; rate: number } | undefined;
  for (const [date, rates] of cubes) {
    if (date > dateIso) continue;
    const rate = rates.get(currency);
    if (rate === undefined) continue;
    if (!best || date > best.date) best = { date, rate };
  }
  if (!best) return undefined;
  return { rate: 1 / best.rate, asOf: best.date };
}

/**
 * The one entry point, see this file's own header for the two-feed strategy. Returns `undefined`
 * (never throws for a "not found" case) when the ECB simply has no rate for this currency on or
 * before `dateIso` even in the full history: the caller (`resolve-vat-currency.ts`) turns that into
 * a named refusal, never a guessed rate. A network/parse failure DOES throw (the same "a transport
 * failure is not the same fact as 'no rate exists'" distinction `ecb-rates-client.ts`'s own header
 * already draws for the daily feed).
 */
export async function resolveEcbRateAsOf(
  currency: string,
  dateIso: string,
): Promise<EcbRateAsOf | undefined> {
  const recentXml = await fetchXml(ECB_HISTORICAL_90D_URL);
  const recent = latestCubeOnOrBefore(parseEcbHistoricalRates(recentXml), currency, dateIso);
  if (recent) return recent;

  // The 90-day window found nothing (older document, or the currency simply is not in the last ~90
  // days of quotes): fall back to the full history, fetched only now, never on the common path.
  const fullXml = await fetchXml(ECB_HISTORICAL_FULL_URL);
  return latestCubeOnOrBefore(parseEcbHistoricalRates(fullXml), currency, dateIso);
}
