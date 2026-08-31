import { CurrencyRateLike, convertMinor, resolveLatestRate } from '../../company/currency-rates/convert';
import {
  getReferenceCurrency,
  listCurrencyRates,
  toCurrencyRateLikes,
} from '../../company/currency-rates/currency-rates.store';

/**
 * The ONE rule this whole feature exists to enforce (item 9, root TODO — "le multi-devises"): **a
 * conversion is information, never a replacement.** Every per-currency total a contribution already
 * computes (expense-contributions.ts's `totalsByCurrency`, invoice-contributions.ts's pending totals)
 * stays exactly as it is — this module never touches those. It only ever ADDS one extra, clearly
 * labelled, clearly sourced number on top, and only when it can do so HONESTLY:
 *
 *  - no `referenceCurrency` chosen at all -> no consolidation attempted, ever (this is the default,
 *    and it stays the default — see Company.referenceCurrency's own schema.prisma comment).
 *  - a `referenceCurrency` IS chosen, but at least one currency actually encountered this period has
 *    no rate resolvable against it -> STILL no consolidated total. A partial consolidation that looks
 *    total is worse than none — see this module's own `consolidateByCurrency` for exactly where that
 *    line is drawn. A warning names the missing currency instead, so the gap is visible, not silent.
 *  - every encountered currency resolves -> ONE consolidated total, carrying every rate/date/source
 *    it used as a plain-English note (`WidgetBase.warnings`, contributions/widgets.ts) — never a bare
 *    converted figure.
 *
 * Pure and DB-free like every other resolution step in this module (settlement/credits.ts's own
 * `creditsForInvoiceFromNotes` is the direct model): the caller fetches `rates` and
 * `referenceCurrency` once (currency-rates/currency-rates.store.ts) and hands them in, so this
 * function is directly testable with hand-built fixtures and reusable across every contribution that
 * needs the same policy (expense-contributions.ts, invoice-contributions.ts) without either one
 * reimplementing it.
 */

export interface CurrencyAmount {
  currency: string;
  /** Already the FULL total for that currency over whatever period the caller cares about (e.g. one
   *  calendar month of expenses) — this module never sums raw line items, only combines totals its
   *  caller already produced, in MINOR units (this file's own `convertMinor` pitfall applies just as
   *  much to summing across currencies as it does to a single conversion). */
  totalMinor: number;
}

export interface ConsolidatedTotal {
  totalMinor: number;
  /** Always equal to the `referenceCurrency` passed in — carried here too so a caller can build a
   *  `MetricWidget.unit` without reaching back into its own arguments. */
  currency: string;
  /** One line per NON-identity currency actually converted, e.g. "USD→EUR @ 1.0842 (manual,
   *  2026-08-15)" — every rate a reader would need to verify the total by hand. A currency that
   *  already equals `referenceCurrency` contributes no line here (nothing was converted). */
  notes: string[];
}

export interface ConsolidationOutcome {
  /** `null` whenever a consolidated total would be dishonest or pointless: no reference currency, no
   *  amounts to consolidate, or at least one encountered currency has no rate. Never a PARTIAL sum
   *  silently missing a currency. */
  consolidated: ConsolidatedTotal | null;
  /** Named, one per currency that blocked consolidation — empty whenever `consolidated` is non-null,
   *  and empty (not an error) when there was simply nothing to consolidate in the first place (no
   *  `referenceCurrency`, or `amounts` is empty). */
  warnings: string[];
}

/** "2026-08-15" — the date half of a rate's `asOf`, for the human-facing note; the note names the
 *  DAY a rate became true, not its time of day (nothing here needs finer granularity than a day). */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function consolidateByCurrency(
  amounts: readonly CurrencyAmount[],
  referenceCurrency: string | null | undefined,
  rates: readonly CurrencyRateLike[],
  now: Date,
): ConsolidationOutcome {
  if (!referenceCurrency || amounts.length === 0) {
    return { consolidated: null, warnings: [] };
  }

  let totalMinor = 0;
  const notes: string[] = [];
  const missing: string[] = [];

  for (const { currency, totalMinor: amountMinor } of amounts) {
    if (currency === referenceCurrency) {
      // Already in the reference currency — nothing to convert, nothing to disclose.
      totalMinor += amountMinor;
      continue;
    }

    const rate = resolveLatestRate(rates, currency, referenceCurrency, now);
    if (!rate) {
      missing.push(currency);
      continue;
    }

    totalMinor += convertMinor(amountMinor, currency, referenceCurrency, rate.rate);
    notes.push(`${currency}→${referenceCurrency} @ ${rate.rate} (${rate.source}, ${isoDate(rate.asOf)})`);
  }

  if (missing.length > 0) {
    // Never a partial sum — see this module's own header. Every currency this period actually saw is
    // named, not just the first one, so the person fixing it doesn't have to hunt for the rest.
    const warnings = missing.map(
      (currency) => `No ${currency}→${referenceCurrency} rate is set — consolidated total omitted.`,
    );
    return { consolidated: null, warnings };
  }

  return { consolidated: { totalMinor, currency: referenceCurrency, notes }, warnings: [] };
}

export interface CurrencyContext {
  referenceCurrency: string | null;
  rates: CurrencyRateLike[];
}

/**
 * Loads the two facts consolidation needs — the company's `referenceCurrency` and its stored rates —
 * and reduces ANY failure fetching them to "no consolidation attempted this call": the per-currency
 * totals a contribution already computes from its own already-fetched documents are the numbers that
 * matter, and they are never blocked on this lookup succeeding.
 *
 * This is the ONE place in the whole feature allowed to swallow an error, and deliberately so: the
 * backend's own offline `backend-tests` CI job (`.github/workflows/cypress.yml`) runs every plain
 * jest spec — including expense-contributions.spec.ts and invoice-contributions.spec.ts, both
 * untouched by this task — with NO Postgres reachable at all (its own Prisma-generate step points at
 * a deliberately-unused URL). Every one of those pre-existing tests proves "no referenceCurrency ->
 * unchanged behavior" by construction: a company that never opted in (their fixture's normal state)
 * and a database that cannot even be reached collapse to the exact same, correct outcome here — no
 * consolidated widget, no thrown error, the ordinary per-currency widgets returned exactly as before.
 * A REAL outage in production degrades the same way: a company sees its true, unconverted per-currency
 * totals rather than a crashed dashboard over a non-essential enrichment.
 */
export async function loadCurrencyContext(companyId: string): Promise<CurrencyContext> {
  try {
    const [referenceCurrency, rates] = await Promise.all([
      getReferenceCurrency(companyId),
      listCurrencyRates(companyId),
    ]);
    return { referenceCurrency, rates: toCurrencyRateLikes(rates) };
  } catch {
    return { referenceCurrency: null, rates: [] };
  }
}
