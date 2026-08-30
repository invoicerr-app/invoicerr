/**
 * Client-side totals calculation — mirrors backend compute-totals.ts logic.
 * Same arithmetic (minor units, VAT per aggregated base), same structure.
 * Any divergence between this and the backend = totals mismatch on the screen vs PDF.
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

export interface ClientLineTotal {
  index: number;
  netMinor: number;
  vatRatePercent: number | null;
  vatMinor: number;
  grossMinor: number;
}

export interface ClientVatBreakdownEntry {
  ratePercent: number;
  baseMinor: number;
  vatMinor: number;
}

export interface ClientDocumentTotals {
  currency: string | null;
  lines: ClientLineTotal[];
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
  vatBreakdown: ClientVatBreakdownEntry[];
  warnings: string[];
}

/**
 * Compute totals from form data. Mirrors backend compute-totals.ts exactly:
 * - All amounts in minor units
 * - Line net = round(toMinor(unitPrice, currency) * quantity)
 * - VAT computed per rate on aggregated base, not per line
 * - Currency from top-level field with 'currency' in key
 * - Quantity defaults to 1, VAT rate to null (counted in net only)
 */
export function computeTotals(
  lines: Array<Record<string, unknown>>,
  currency: string | null,
  moneyFieldKey: string,
  numberFieldKey: string | undefined,
  vatRateFieldKey: string | undefined,
): ClientDocumentTotals {
  const warnings: string[] = [];
  const processedLines: Array<{
    index: number;
    netMinor: number;
    vatRatePercent: number | null;
  }> = [];

  // Process each line
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];

    // Extract quantity (default 1)
    let quantity = 1;
    if (numberFieldKey) {
      const qtyValue = line[numberFieldKey];
      if (typeof qtyValue === 'number') {
        quantity = qtyValue;
      }
    }

    // Extract unit price and convert to minor
    let unitPriceMinor = 0;
    const priceValue = line[moneyFieldKey];
    if (typeof priceValue === 'number') {
      unitPriceMinor = toMinor(priceValue, currency || 'EUR');
    }

    // Calculate net for this line (in minor units)
    const netMinor = Math.round(unitPriceMinor * quantity);

    // Extract VAT rate
    let vatRatePercent: number | null = null;
    if (vatRateFieldKey) {
      const rateValue = line[vatRateFieldKey];
      if (rateValue !== undefined && rateValue !== null && rateValue !== '') {
        const parsed = Number(rateValue);
        if (!Number.isNaN(parsed)) {
          vatRatePercent = parsed;
        } else {
          warnings.push(`line ${lineIndex + 1} has no usable VAT rate — counted in net only`);
        }
      } else {
        warnings.push(`line ${lineIndex + 1} has no usable VAT rate — counted in net only`);
      }
    } else {
      warnings.push(`line ${lineIndex + 1} has no usable VAT rate — counted in net only`);
    }

    processedLines.push({ index: lineIndex, netMinor, vatRatePercent });
  }

  // Build line totals and accumulate by VAT rate
  const resultLines: ClientLineTotal[] = [];
  const rateToBase: Record<string, number> = {};

  for (const { index, netMinor, vatRatePercent } of processedLines) {
    const lineVatMinor = vatRatePercent !== null ? Math.round(netMinor * vatRatePercent / 100) : 0;
    const lineGrossMinor = netMinor + lineVatMinor;

    resultLines.push({
      index,
      netMinor,
      vatRatePercent,
      vatMinor: lineVatMinor,
      grossMinor: lineGrossMinor,
    });

    // Accumulate base by rate (only for lines with VAT)
    if (vatRatePercent !== null) {
      const rateKey = String(vatRatePercent);
      rateToBase[rateKey] = (rateToBase[rateKey] ?? 0) + netMinor;
    }
  }

  // Compute VAT breakdown (by aggregated base per rate)
  const vatBreakdown: ClientVatBreakdownEntry[] = [];
  let totalNetMinor = 0;
  let totalVatMinor = 0;

  // VAT per rate (on aggregated base)
  for (const rateStr of Object.keys(rateToBase).sort((a, b) => Number(a) - Number(b))) {
    const ratePercent = Number(rateStr);
    const baseMinor = rateToBase[rateStr];
    const vatMinor = Math.round(baseMinor * ratePercent / 100);

    vatBreakdown.push({ ratePercent, baseMinor, vatMinor });
    totalNetMinor += baseMinor;
    totalVatMinor += vatMinor;
  }

  // Lines with null rate (no VAT) contribute to net
  for (const line of resultLines) {
    if (line.vatRatePercent === null) {
      totalNetMinor += line.netMinor;
    }
  }

  const totalGrossMinor = totalNetMinor + totalVatMinor;

  return {
    currency,
    lines: resultLines,
    netMinor: totalNetMinor,
    vatMinor: totalVatMinor,
    grossMinor: totalGrossMinor,
    vatBreakdown,
    warnings,
  };
}
