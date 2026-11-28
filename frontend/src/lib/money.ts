const CURRENCY_DECIMALS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
}

export function decimalsFor(currency: string): number {
  return CURRENCY_DECIMALS[currency?.toUpperCase()] ?? 2
}

export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** decimalsFor(currency))
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** decimalsFor(currency)
}

/** `1234.50 EUR`, the one money formatter every screen uses, so a minor-unit amount never rounds
 *  differently from one view to the next. The currency is printed as given (callers that want a
 *  placeholder for an empty one pass it themselves). */
export function formatMinor(minor: number, currency: string): string {
  return `${fromMinor(minor, currency).toFixed(decimalsFor(currency))} ${currency}`
}
