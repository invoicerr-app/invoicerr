/**
 * Decimals per currency (ISO 4217). Used to live in the compliance engine, now removed — but this
 * is not a tax rule: it's the currency's own subdivision. The yen has no cents, the Kuwaiti dinar
 * has a thousand. Everything else is 2.
 */
const CURRENCY_DECIMALS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
};

export function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency?.toUpperCase()] ?? 2;
}

export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** decimalsFor(currency));
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** decimalsFor(currency);
}

/** A minor-unit amount in MAJOR units, fixed to the currency's own decimal count: `1234` EUR ->
 *  `"12.34"`, `1234` JPY -> `"1234"`. The one rounding rule every rendered amount goes through. */
export function formatMinorFixed(minor: number, currency: string): string {
  return fromMinor(minor, currency).toFixed(decimalsFor(currency));
}

/** `formatMinorFixed` followed by the currency code as given (`"12.34 EUR"`), the same shape as the
 *  frontend's own `formatMinor` (`totals-calculator.ts`). */
export function formatMinor(minor: number, currency: string): string {
  return `${formatMinorFixed(minor, currency)} ${currency}`;
}
