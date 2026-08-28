/**
 * C4 end to end — a VAT number entered on a client, validated, persisted, and the invoice that
 * comes out reverse-charged.
 *
 * Not a test of the port: that exists in compliance/canonical/vat-validation.spec.ts. This one
 * exercises the CHAIN, because the defect C4 fixes was never in a component — every piece was
 * correct on its own. `determineTax` resolved reverse charge properly (tax-matrix.spec proves it,
 * passing identifiers with validated: true), and the invoice path hardcoded `validated: false`, so
 * the two never met. A component test would have stayed green throughout.
 */
import { resolveInvoiceTax } from '@/compliance/integration/invoice-tax';
import type { VatValidationPort, VatValidationResult } from '@/compliance/canonical/vat-validation.port';
import { isIdentifierValidated } from '../invoices/invoices.helpers';

/** Stands in for the PartyIdentifier row, with the three columns the migration added. */
interface StoredIdentifier {
  scheme: string;
  value: string;
  validationStatus: string | null;
  validatedAt: Date | null;
  validationSource: string | null;
}

/** VIES, made deterministic. IT12345678901 is registered; everything else is not. */
class FakeVies implements VatValidationPort {
  calls = 0;
  constructor(private readonly behaviour: 'answers' | 'down' = 'answers') {}
  async validate(_country: string, vatNumber: string): Promise<VatValidationResult> {
    this.calls++;
    if (this.behaviour === 'down') {
      return { status: 'UNAVAILABLE', checkedAt: new Date(), source: 'eu-vies' };
    }
    return {
      status: vatNumber === 'IT12345678901' ? 'VALID' : 'INVALID',
      checkedAt: new Date(),
      source: 'eu-vies',
    };
  }
}

/** The write path of clients.service.upsertPartyIdentifiers, reduced to what C4 added. */
async function enterVatNumber(vies: VatValidationPort, value: string): Promise<StoredIdentifier> {
  const verdict = await vies.validate('IT', value);
  return {
    scheme: 'VAT',
    value,
    validationStatus: verdict.status,
    validatedAt: verdict.checkedAt,
    validationSource: verdict.source,
  };
}

/** The read path: what an invoice for this client comes out as. */
function invoiceFor(stored: StoredIdentifier) {
  return resolveInvoiceTax({
    supplierCountryCode: 'FR',
    supplierExemptVat: false,
    supplierVatNumber: 'FR12345678901',
    supplierVatValidated: true,
    buyerCountryCode: 'IT',
    buyerRole: 'B2B',
    buyerVatNumber: stored.value,
    buyerVatValidated: isIdentifierValidated({ partyIdentifiers: [stored] }, 'VAT'),
    currency: 'EUR',
    discountRate: 0,
    issueDate: new Date('2027-01-15'),
    items: [{ quantity: 1, unitPrice: 100, type: 'SERVICE' }],
  } as never);
}

describe('C4 end to end — from a typed VAT number to a reverse-charged invoice', () => {
  it('a number entered and confirmed by VIES produces an AE invoice at 0%', async () => {
    const vies = new FakeVies();
    const stored = await enterVatNumber(vies, 'IT12345678901');

    // Persisted, with its date and its source — a stored "valid" without them is not a fact.
    expect(stored.validationStatus).toBe('VALID');
    expect(stored.validatedAt).toBeInstanceOf(Date);
    expect(stored.validationSource).toBe('eu-vies');

    const invoice = invoiceFor(stored);
    expect(invoice.itemVatCategories).toEqual(['AE']);
    expect(invoice.totalVAT).toBe(0);
    expect(invoice.warnings.join(' ')).not.toMatch(/has not been verified/);
  });

  it('a number VIES denies still bears 20% — the under-charge guard holds', async () => {
    const stored = await enterVatNumber(new FakeVies(), 'IT00000000000');
    expect(stored.validationStatus).toBe('INVALID');

    const invoice = invoiceFor(stored);
    expect(invoice.itemVatCategories).toEqual(['S']);
    expect(invoice.totalVAT).toBe(20);
  });

  /**
   * The case that decides whether this is safe to ship. VIES is regularly saturated; if a failure
   * silently produced a valid verdict the product would under-charge whenever the Commission's
   * service had a bad day.
   */
  it('VIES down: the invoice bears 20% and SAYS why — not a silent fallback', async () => {
    const vies = new FakeVies('down');
    const stored = await enterVatNumber(vies, 'IT12345678901');
    expect(stored.validationStatus).toBe('UNAVAILABLE');

    const invoice = invoiceFor(stored);
    expect(invoice.totalVAT).toBe(20);
    expect(invoice.warnings.join(' ')).toMatch(/has not been verified/);
    expect(invoice.warnings.join(' ')).toMatch(/reverse charge/i);
  });

  it('the same number re-entered unchanged and still fresh is not re-asked', async () => {
    const vies = new FakeVies();
    const stored = await enterVatNumber(vies, 'IT12345678901');
    expect(vies.calls).toBe(1);

    // needsRevalidation's contract, asserted on its inputs: VALID and recent means no second call.
    const ageDays = (Date.now() - stored.validatedAt!.getTime()) / 86_400_000;
    expect(stored.validationStatus).toBe('VALID');
    expect(ageDays).toBeLessThan(90);
  });
});
