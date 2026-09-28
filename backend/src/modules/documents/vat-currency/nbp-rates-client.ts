/**
 * Poland's own rate source for issue #517. VAT act art. 31a ust. 1 names NBP Table A specifically
 * ("Narodowy Bank Polski") as the default rate, on the LAST BUSINESS DAY PRECEDING the day the tax
 * obligation arises (strictly BEFORE, unlike France's/Italy's own "on or before", see
 * `data/pl.json`'s own `rateDateRule`). The statute also lets a taxpayer opt into the ECB rate
 * instead; this client never does that: issue #517 is explicit that Poland's source is "NBP table A
 * ... or a clear refusal when no NBP rate is available; never silently use another source", so a
 * failure here is always a named refusal (`resolve-vat-currency.ts`), never a silent
 * `ecb-historical-rates-client.ts` fallback.
 *
 * NBP publishes a free, no-key JSON API (api.nbp.pl), no historical feed to parse by hand the way
 * the ECB's own XML export requires: `GET /api/exchangerates/rates/a/{code}/{start}/{end}/` returns
 * exactly the Table A quotations NBP actually published inside `[start, end]`, one entry per business
 * day, silently OMITTING every weekend/holiday NBP does not publish for (never a repeated/padded
 * entry the way the ECB's own DAILY feed pins its `time` attribute over a weekend, see
 * `ecb-rates-client.ts`'s own header on that different behaviour). Requesting a window ENDING the day
 * BEFORE the target date and taking the LAST entry NBP actually returns is therefore exactly "the
 * last business day preceding the target date" the statute asks for, no separate business-day
 * calendar needed.
 */
const NBP_API_BASE = 'https://api.nbp.pl/api/exchangerates/rates/a';
const FETCH_TIMEOUT_MS = 10_000;
/** How many calendar days to look back for a published quotation, wide enough to cross Poland's
 *  longest ordinary run of consecutive non-publishing days (a weekend abutting a public holiday).
 *  Widened here rather than retried with a growing window, since a single request covering it is
 *  cheaper than a retry loop for what is, in the overwhelming majority of calls, a single business
 *  day away. */
const LOOKBACK_DAYS = 10;

export interface NbpRateAsOf {
  /** PLN per 1 unit of the requested currency, NBP's own `mid` figure, already in the direction
   *  `convert.ts#convertMinor` needs (no inversion: unlike the ECB feed, NBP already quotes "1 unit
   *  of X is worth this many PLN"). */
  rate: number;
  /** The NBP-published business day this quotation is actually dated to, ISO `yyyy-mm-dd`: the last
   *  one NBP returned inside the lookback window, i.e. the last business day strictly before the
   *  requested date. */
  asOf: string;
}

interface NbpRatesResponse {
  code: string;
  currency: string;
  rates: { no: string; effectiveDate: string; mid: number }[];
}

function isoDateMinusDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The one entry point. `beforeDateIso` is the date the rate must be dated STRICTLY BEFORE (the
 * invoice's own tax-point approximation, see `data/pl.json`'s own `rateDateRule`); this function
 * itself computes the `[beforeDateIso - LOOKBACK_DAYS, beforeDateIso - 1 day]` window, so callers
 * never pass a raw NBP date range.
 *
 * Returns `undefined`, never throws, for the two "genuinely no rate" cases NBP's own API expresses
 * differently: a 404 (nothing published for this currency/range at all, NBP's own "brak danych"
 * response) and a 200 with an empty `rates` array (a currency NBP tracks but simply had nothing to
 * quote for these specific days, which the API treats as a normal, non-error response). Either way
 * the caller (`resolve-vat-currency.ts`) turns this into the SAME named refusal issue #517 asks for:
 * "never silently use another source" applies to a network/parse failure exactly as much as to a
 * genuinely empty result, so BOTH throw for anything that is not one of these two well-understood
 * "not found" shapes (a malformed body, a non-404 HTTP error), never silently treated as "no rate".
 */
export async function resolveNbpRateBefore(
  currency: string,
  beforeDateIso: string,
): Promise<NbpRateAsOf | undefined> {
  const endDate = isoDateMinusDays(beforeDateIso, 1);
  const startDate = isoDateMinusDays(beforeDateIso, LOOKBACK_DAYS);
  const url = `${NBP_API_BASE}/${encodeURIComponent(currency.toLowerCase())}/${startDate}/${endDate}/?format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) return undefined; // NBP's own "no data for this range" response.
  if (!response.ok) {
    throw new Error(`NBP Table A rates API responded with HTTP ${response.status} for "${currency}".`);
  }

  const body = (await response.json()) as NbpRatesResponse;
  if (!Array.isArray(body.rates) || body.rates.length === 0) return undefined;

  // NBP returns quotations in chronological order: the LAST one is the most recent, i.e. the last
  // business day inside the window, which (the window ending the day before `beforeDateIso`) is
  // exactly "the last business day preceding `beforeDateIso`".
  const latest = body.rates[body.rates.length - 1];
  if (typeof latest.mid !== 'number' || !Number.isFinite(latest.mid) || latest.mid <= 0) {
    throw new Error(
      `NBP Table A rates API returned a non-numeric rate for "${currency}": ${JSON.stringify(latest)}.`,
    );
  }
  return { rate: latest.mid, asOf: latest.effectiveDate };
}
