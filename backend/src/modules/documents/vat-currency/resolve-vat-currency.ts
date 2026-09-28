/**
 * The pure(ish) resolution step between a country's own `VatCurrencyRule` (registry.ts) and the two
 * rate clients (`ecb-historical-rates-client.ts`/`nbp-rates-client.ts`). Mirrors
 * `settlement/convert-payment.ts#resolvePaymentConversion`'s own shape (a named, typed result rather
 * than a bare throw for the ordinary "nothing to convert" case), except this one genuinely needs to
 * be `async` (the two rate clients are real network calls, unlike `convert.ts#resolveLatestRate`'s
 * in-memory lookup over already-fetched `CurrencyRate` rows), so "pure" here means "no Prisma, no
 * Nest DI", the same narrower sense `ecb-rates-client.ts`'s own header already uses for itself.
 */
import { convertMinor } from '../../company/currency-rates/convert';
import { resolveEcbRateAsOf } from './ecb-historical-rates-client';
import {
  fakeResolveEcbRateAsOf,
  fakeResolveNbpRateBefore,
  vatCurrencyRateFakeEnabled,
} from './fake-rate-clients';
import { resolveNbpRateBefore } from './nbp-rates-client';
import { resolveVatCurrencyRule } from './registry';
import { VatCurrencyRule } from './schema';

/** Thrown when a country's rule REQUIRES a converted VAT figure but the named rate source has
 *  nothing to offer for this invoice's own date: the LOAD-BEARING block issue #517 asks for
 *  ("Poland needs NBP table A rates: add the source, or state what happens without it" / "a clear
 *  refusal when no NBP rate is available; never silently use another source"). Never caught and
 *  silently swallowed anywhere in the preflight path; only `attachVatNationalCurrencyToNumberedDocument`
 *  (vat-currency-issuance.ts), running strictly AFTER the preflight already approved this exact same
 *  call, treats a (now vanishingly unlikely) recurrence of it as a defensive degrade, the same
 *  posture `atcud-issuance.ts#attachAtcudToNumberedDocument` already holds for its own post-preflight
 *  re-check. */
export class VatCurrencyRateUnavailableError extends Error {}

export interface VatCurrencyConversion {
  nationalCurrency: string;
  /** Converted taxable amount (net), minor units. `null` unless the country's own rule requires it
   *  too (Italy today; see `VatCurrencyRule.taxableAmountRequiredOnInvoice`). */
  taxableMinor: number | null;
  vatMinor: number;
  /** Units of `nationalCurrency` per one unit of the invoice's own currency. */
  rate: number;
  /** ISO `yyyy-mm-dd`: the actual dated business day this rate was published for, which is NOT
   *  necessarily the invoice's own `issueDate` (a weekend/holiday issue date resolves to the last
   *  business day before/on it, see each rate source's own header). */
  rateAsOf: string;
  rateSource: 'ecb' | 'nbp';
}

/**
 * Resolves the whole conversion for one invoice. `null` (never a block) when there is genuinely
 * nothing to do: no rule for this seller country at all, the country's rule does not require this on
 * the invoice, or the invoice is already denominated in the country's own national currency (nothing
 * to convert). Throws `VatCurrencyRateUnavailableError`, and ONLY that, when a real requirement
 * cannot be honoured because the named source has no rate; every other failure (a network error, a
 * malformed response) propagates as whatever `ecb-historical-rates-client.ts`/`nbp-rates-client.ts`
 * themselves threw, unwrapped, so it surfaces as a genuine 500 rather than being misreported as "no
 * rate exists", the same "a transport failure is not the same fact as 'not found'" distinction those
 * two files' own headers already draw.
 */
export async function resolveVatCurrencyConversion(
  sellerCountryCode: string,
  invoiceCurrency: string,
  issueDate: string,
  totals: { netMinor: number; vatMinor: number },
): Promise<VatCurrencyConversion | null> {
  const rule = resolveVatCurrencyRule(sellerCountryCode);
  if (!rule?.requiredOnInvoice) return null;
  if (invoiceCurrency === rule.nationalCurrency) return null;

  const resolved = await resolveRate(rule, invoiceCurrency, issueDate, sellerCountryCode);

  return {
    nationalCurrency: rule.nationalCurrency,
    taxableMinor: rule.taxableAmountRequiredOnInvoice
      ? convertMinor(totals.netMinor, invoiceCurrency, rule.nationalCurrency, resolved.rate)
      : null,
    vatMinor: convertMinor(totals.vatMinor, invoiceCurrency, rule.nationalCurrency, resolved.rate),
    rate: resolved.rate,
    rateAsOf: resolved.asOf,
    rateSource: resolved.source,
  };
}

async function resolveRate(
  rule: VatCurrencyRule,
  invoiceCurrency: string,
  issueDate: string,
  sellerCountryCode: string,
): Promise<{ rate: number; asOf: string; source: 'ecb' | 'nbp' }> {
  if (rule.rateSource === 'ecb') {
    // See `fake-rate-clients.ts`'s own header: `VAT_CURRENCY_RATE_FAKE=1` (test env only) swaps the
    // real network call for a deterministic, offline fake so e2e/CI never depends on the ECB feed.
    const resolved = vatCurrencyRateFakeEnabled()
      ? fakeResolveEcbRateAsOf(invoiceCurrency, issueDate)
      : await resolveEcbRateAsOf(invoiceCurrency, issueDate);
    if (!resolved) {
      throw new VatCurrencyRateUnavailableError(
        `No ECB reference rate is available for "${invoiceCurrency}" on or before ${issueDate}. This ` +
          `${sellerCountryCode} invoice's VAT cannot be converted to ${rule.nationalCurrency} without one ` +
          `(vat-currency/data/${sellerCountryCode.toLowerCase()}.json names ECB as the required rate source).`,
      );
    }
    return { ...resolved, source: 'ecb' };
  }

  if (rule.rateSource === 'nbp') {
    const resolved = vatCurrencyRateFakeEnabled()
      ? fakeResolveNbpRateBefore(invoiceCurrency, issueDate)
      : await resolveNbpRateBefore(invoiceCurrency, issueDate);
    if (!resolved) {
      throw new VatCurrencyRateUnavailableError(
        `No NBP Table A rate is available for "${invoiceCurrency}" in the ${10} days preceding ${issueDate}. ` +
          "Poland's VAT act art. 31a ust. 1 names NBP Table A specifically, and this codebase never " +
          'silently substitutes another source for it. Try again once NBP has published a rate for this ' +
          `currency, or issue this invoice in ${rule.nationalCurrency} directly.`,
      );
    }
    return { ...resolved, source: 'nbp' };
  }

  // rule.rateSource === 'none' with requiredOnInvoice === true is refused by
  // `assertValidVatCurrencyRule` at catalog-load time, unreachable in practice, kept as a named
  // throw rather than a silent `undefined` return so a future rateSource value added to the union
  // without updating this function fails loudly instead of pretending to convert.
  throw new VatCurrencyRateUnavailableError(
    `"${sellerCountryCode}" declares a VAT-currency requirement with an unhandled rate source ` +
      `"${rule.rateSource}", a catalog/code mismatch, not a missing rate.`,
  );
}
