import { computeDocumentTotals } from './compute-totals';
import type { DocumentTypeDescriptor, DocumentFieldDescriptor } from '../descriptors/types';

/**
 * Helper to build a minimal descriptor with the structure needed for these tests.
 */
function buildTestDescriptor(
  options: {
    currencyField?: boolean;
    arrayField?:
      | boolean
      | {
          moneyKey?: string;
          numberKey?: string;
          vatRateKey?: string;
        };
  } = {},
): DocumentTypeDescriptor {
  const fields: DocumentFieldDescriptor[] = [];

  if (options.currencyField !== false) {
    fields.push({
      key: 'currency',
      kind: 'select',
      label: 'Currency',
      options: [],
    });
  }

  if (options.arrayField !== false) {
    const arrayFieldConfig = typeof options.arrayField === 'object' ? options.arrayField : {};
    const moneyKey = arrayFieldConfig?.moneyKey ?? 'unitPrice';
    const numberKey = arrayFieldConfig?.numberKey ?? 'quantity';
    const vatRateKey = arrayFieldConfig?.vatRateKey ?? 'vatRate';

    fields.push({
      key: 'lines',
      kind: 'array',
      label: 'Lines',
      fields: [
        { key: 'description', kind: 'text', label: 'Description' },
        { key: numberKey, kind: 'number', label: 'Quantity' },
        { key: moneyKey, kind: 'money', label: 'Unit Price' },
        {
          key: vatRateKey,
          kind: 'select',
          label: 'VAT Rate',
          options: [
            { value: '0', label: '0%' },
            { value: '5.5', label: '5.5%' },
            { value: '20', label: '20%' },
          ],
        },
      ],
    });
  }

  return {
    id: 'test-type',
    label: 'Test Type',
    fields,
    actions: [],
  };
}

describe('computeDocumentTotals', () => {
  it('calculates net/vat/gross for two lines at 20%', () => {
    const descriptor = buildTestDescriptor();
    const data = {
      currency: 'EUR',
      lines: [
        { description: 'Item 1', quantity: 1, unitPrice: 100, vatRate: '20' },
        { description: 'Item 2', quantity: 1, unitPrice: 100, vatRate: '20' },
      ],
    };

    const result = computeDocumentTotals(descriptor, data);

    expect(result.netMinor).toBe(20000); // 100 + 100 = 200 EUR = 20000 cents
    expect(result.vatMinor).toBe(4000); // 20% of 20000 = 4000 cents
    expect(result.grossMinor).toBe(24000);
    expect(result.currency).toBe('EUR');
    expect(result.vatBreakdown).toHaveLength(1);
    expect(result.vatBreakdown[0]).toEqual({
      ratePercent: 20,
      baseMinor: 20000,
      vatMinor: 4000,
    });
  });

  it('handles mixed VAT rates with correct breakdown', () => {
    const descriptor = buildTestDescriptor();
    const data = {
      currency: 'EUR',
      lines: [
        { description: 'Item 20%', quantity: 1, unitPrice: 100, vatRate: '20' },
        { description: 'Item 5.5%', quantity: 1, unitPrice: 100, vatRate: '5.5' },
      ],
    };

    const result = computeDocumentTotals(descriptor, data);

    expect(result.netMinor).toBe(20000);
    // 20% of 10000 cents = 2000 cents
    // 5.5% of 10000 cents = 550 cents
    // Total VAT = 2000 + 550 = 2550 cents
    expect(result.vatMinor).toBe(2550);
    expect(result.grossMinor).toBe(22550);
    expect(result.vatBreakdown).toHaveLength(2);
    expect(result.vatBreakdown[0]).toEqual({
      ratePercent: 5.5,
      baseMinor: 10000,
      vatMinor: 550,
    });
    expect(result.vatBreakdown[1]).toEqual({
      ratePercent: 20,
      baseMinor: 10000,
      vatMinor: 2000,
    });
  });

  it('demonstrates VAT rounding per aggregated base vs per line', () => {
    // This is the critical test: 3 lines at 0.01 EUR each (1 cent) at 20% VAT
    // Per line: round(1 * 0.20) = round(0.2) = 0 cents each → total 0
    // Per base (aggregated): 3 cents × 0.20 = round(0.6) = 1 cent
    // We calculate per base, so should get 1 cent
    const descriptor = buildTestDescriptor();
    const data = {
      currency: 'EUR',
      lines: [
        { description: 'Item 1', quantity: 1, unitPrice: 0.01, vatRate: '20' },
        { description: 'Item 2', quantity: 1, unitPrice: 0.01, vatRate: '20' },
        { description: 'Item 3', quantity: 1, unitPrice: 0.01, vatRate: '20' },
      ],
    };

    const result = computeDocumentTotals(descriptor, data);

    // 0.01 EUR each = 1 cent each = 3 cents total
    expect(result.netMinor).toBe(3);
    // VAT: round(3 * 20 / 100) = round(0.6) = 1 cent (this is why we aggregate!)
    expect(result.vatMinor).toBe(1);
    expect(result.grossMinor).toBe(4);
    // The breakdown shows the aggregated base
    expect(result.vatBreakdown[0]).toEqual({
      ratePercent: 20,
      baseMinor: 3,
      vatMinor: 1,
    });
  });

  it('counts lines without VAT rate in net only', () => {
    const descriptor = buildTestDescriptor();
    const data = {
      currency: 'EUR',
      lines: [
        { description: 'Item with VAT', quantity: 1, unitPrice: 100, vatRate: '20' },
        { description: 'Item no VAT', quantity: 1, unitPrice: 100, vatRate: null },
      ],
    };

    const result = computeDocumentTotals(descriptor, data);

    // Net: 100 EUR with rate + 100 EUR without rate = 200 EUR = 20000 cents
    expect(result.netMinor).toBe(20000);
    // VAT: only on the first line (100 EUR at 20% = 2000 cents)
    expect(result.vatMinor).toBe(2000);
    expect(result.grossMinor).toBe(22000);
    // Warnings
    expect(result.warnings).toContainEqual(expect.stringContaining('line 2 has no usable VAT rate'));
    // Only one VAT breakdown entry
    expect(result.vatBreakdown).toHaveLength(1);
    expect(result.vatBreakdown[0].ratePercent).toBe(20);
    expect(result.vatBreakdown[0].baseMinor).toBe(10000); // Only the 100 EUR with rate
  });

  it('handles missing currency with null and warning', () => {
    const descriptor = buildTestDescriptor({ currencyField: false });
    const data = {
      lines: [{ description: 'Item', quantity: 1, unitPrice: 100, vatRate: '20' }],
    };

    const result = computeDocumentTotals(descriptor, data);

    expect(result.currency).toBeNull();
    expect(result.warnings).toContainEqual(expect.stringContaining('Document currency not found'));
    // Should still calculate using default 2 decimals (100 EUR = 10000 cents)
    expect(result.netMinor).toBe(10000);
    expect(result.vatMinor).toBe(2000);
  });

  it('handles JPY (0 decimals) correctly', () => {
    // 1000 yen × 2 at 10% VAT
    const descriptor = buildTestDescriptor();
    const data = {
      currency: 'JPY',
      lines: [{ description: 'Item', quantity: 2, unitPrice: 1000, vatRate: '10' }],
    };

    const result = computeDocumentTotals(descriptor, data);

    // JPY has 0 decimals, so 1000 JPY = 1000 (in minor = major)
    // Net = 1000 × 2 = 2000
    expect(result.netMinor).toBe(2000);
    // VAT = 2000 × 10% = 200
    expect(result.vatMinor).toBe(200);
    expect(result.grossMinor).toBe(2200);
  });

  it('returns zero totals when descriptor has no array fields', () => {
    const descriptor = buildTestDescriptor({ arrayField: false });
    const data = { currency: 'EUR' };

    const result = computeDocumentTotals(descriptor, data);

    expect(result.netMinor).toBe(0);
    expect(result.vatMinor).toBe(0);
    expect(result.grossMinor).toBe(0);
    expect(result.lines).toHaveLength(0);
    expect(result.vatBreakdown).toHaveLength(0);
  });

  it('defaults quantity to 1 when missing', () => {
    const descriptor = buildTestDescriptor();
    const data = {
      currency: 'EUR',
      lines: [{ description: 'Item', quantity: undefined, unitPrice: 50, vatRate: '20' }],
    };

    const result = computeDocumentTotals(descriptor, data);

    // 50 EUR × 1 = 50 EUR = 5000 cents
    expect(result.netMinor).toBe(5000);
    expect(result.vatMinor).toBe(1000); // 20% of 5000
  });
});
