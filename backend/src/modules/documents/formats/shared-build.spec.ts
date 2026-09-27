/**
 * `extractLines` (shared-build.ts) is the ONE choke point every EN 16931-syntax format provider
 * builds a semantic line from — CII (cii-provider.ts), UBL (ubl-provider.ts), and, through those two
 * or `buildEuInvoiceForDocument` directly, Factur-X (facturx-provider.ts), XRechnung
 * (xrechnung-provider.ts) and Peppol BIS (peppol-bis-provider.ts) as well — see this file's own
 * `shared-build.ts` header. It reads a FIXED, named set of keys off each row and never spreads the
 * row itself, so any key the invoice/quote line shape carries that this function does not explicitly
 * name is structurally invisible to every one of those five formats — proven directly here rather
 * than through five separate XML-generation round-trips (see providers.spec.ts for one such
 * round-trip on CII/UBL specifically, asserting the same thing against real generated XML).
 */
import { extractLines } from './shared-build';

describe('extractLines — the EN 16931 line whitelist', () => {
  it('drops an unmapped `date` key entirely — issue #145 must not leak into a generated EN 16931 payload unless deliberately mapped', () => {
    const lines = extractLines({
      lines: [{ description: 'Consulting', quantity: 1, unit: 'day', unitPrice: 1000, date: '2026-05-01' }],
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toHaveProperty('date');
    expect(Object.keys(lines[0])).toEqual([
      'description',
      'quantity',
      'unit',
      'unitPrice',
      'supplyType',
      'vatCategory',
      'exemptionReason',
    ]);
  });

  it('still extracts every field it DOES map, on the exact same row', () => {
    const lines = extractLines({
      lines: [{ description: 'Consulting', quantity: 2, unit: 'hour', unitPrice: 150.5, date: '2026-05-01' }],
    });

    expect(lines[0]).toMatchObject({
      description: 'Consulting',
      quantity: 2,
      unit: 'hour',
      unitPrice: 150.5,
    });
  });

  it('any OTHER unmapped, unrelated key on a row is dropped exactly the same way — `date` is not a special case', () => {
    const lines = extractLines({
      lines: [{ description: 'Consulting', quantity: 1, unit: 'day', unitPrice: 1000, someFutureField: 'x' }],
    });

    expect(lines[0]).not.toHaveProperty('someFutureField');
  });
});
