import { CurrencyRateLike, convertMinor, resolveLatestRate } from '../../company/currency-rates/convert';

/**
 * TODO_PRODUIT.md T3 — the ONE per-operation conversion decision the TODO_ISSUES.md entry this task
 * closes ("les taux existent, mais paiements et avoirs ne convertissent toujours pas") demanded: "un
 * taux PAR OPÉRATION (saisi au moment du paiement, stocké sur lui), pas le taux ambiant de la
 * société." Pure and DB-free, same discipline as `contributions/currency-consolidation.ts`'s own
 * `consolidateByCurrency` — the caller (`actions/invoice-actions.ts`'s "record-payment") fetches
 * `rates` ONCE and hands them in.
 *
 * `at` is the DATE this resolves the rate against — the PAYMENT's own `paidAt`, never "now": a
 * payment received last month, entered into the system today, converts at the rate that was true
 * WHEN THE MONEY ARRIVED, not at today's rate (see `resolveLatestRate`'s own header: "most recent
 * row whose `asOf` is not in the future" — "future" relative to `at`, not the server's clock). This
 * is also why the result must be PERSISTED by the caller (`DocumentPayment.documentAmountMinor`/
 * `conversionRate`/`conversionRateAsOf`/`conversionSource` — see that model's own schema.prisma
 * comment): `CurrencyRate` rows are append-only, but a row entered LATER with an `asOf` landing
 * between two already-resolved dates would otherwise change what a FRESH lookup returns for this
 * same `paidAt` — re-resolving on every read would let today's data-entry silently rewrite an
 * already-reported balance. This function is called exactly once per payment, at record time.
 *
 * ## The rounding decision
 * Reuses `convertMinor` (convert.ts) verbatim — the SAME arithmetic `currency-consolidation.ts`
 * already uses for the dashboard's consolidated totals: climb to MAJOR units, apply the rate, round
 * to the TARGET currency's own minor units (`Math.round`, i.e. round-half-up). Deliberately NOT a
 * second, payment-specific rounding rule: a codebase with two different "how do I round a converted
 * amount" answers would eventually disagree with itself about a single euro-cent, and there is no
 * business reason a payment's rounding should differ from a dashboard metric's. See convert.ts's own
 * header for the full "climb to major units first" reasoning this inherits.
 */
export type PaymentConversionResult =
  | {
      ok: true;
      /** The settlement-relevant figure — `paymentAmountMinor` expressed in the DOCUMENT's own
       *  currency. Equal to `paymentAmountMinor` itself (same currency, same units) when no
       *  conversion was needed. */
      documentAmountMinor: number;
      /** Null exactly when no conversion was applied (same currency) — mirrors
       *  `DocumentPayment.conversionRate`'s own null-means-no-conversion convention. */
      rate: number | null;
      rateAsOf: Date | null;
      rateSource: string | null;
    }
  | {
      /** No dated rate could be resolved for this currency pair as of `at` — the caller refuses the
       *  payment outright (this module never invents a rate, and never silently drops the mismatch —
       *  same "no permissive fallback" posture `country-policy.ts`'s own resolvers hold). */
      ok: false;
    };

export function resolvePaymentConversion(
  documentCurrency: string,
  paymentCurrency: string,
  paymentAmountMinor: number,
  rates: readonly CurrencyRateLike[],
  at: Date,
): PaymentConversionResult {
  if (paymentCurrency === documentCurrency) {
    return {
      ok: true,
      documentAmountMinor: paymentAmountMinor,
      rate: null,
      rateAsOf: null,
      rateSource: null,
    };
  }

  const rate = resolveLatestRate(rates, paymentCurrency, documentCurrency, at);
  if (!rate) {
    return { ok: false };
  }

  return {
    ok: true,
    documentAmountMinor: convertMinor(paymentAmountMinor, paymentCurrency, documentCurrency, rate.rate),
    rate: rate.rate,
    rateAsOf: rate.asOf,
    rateSource: rate.source,
  };
}
