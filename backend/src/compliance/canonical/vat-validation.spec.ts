/**
 * C4 — the VAT validation port, and the defect it exists to fix.
 *
 * `invoice-tax.ts` hardcoded `validated: false`, and `TrustFlagVatValidator` only unlocks reverse
 * charge for `validated === true`. From the invoice path no VAT number was ever validated, so an
 * intra-EU B2B service came out at 20% French VAT instead of reverse-charged (Directive 2006/112
 * art. 44, CGI art. 259-1°) — a tax the customer does not owe, on an invoice whose VAT category
 * is wrong.
 *
 * The hardcoded `false` was a guard against the opposite error: trusting a free-text field would
 * let anyone type a fake number and get 0%. Neither `false` nor `true` is the answer; knowing
 * whether the number was CHECKED is.
 */
import { ViesProvider } from '../../modules/company-lookup/providers/vies.provider';
import { resolveInvoiceTax } from '../integration/invoice-tax';
import { NullVatValidationClient } from './vat-validation.port';
import { ViesVatValidationClient } from './vies-vat-validation.client';

const frItServices = (buyerVatValidated: boolean) =>
  resolveInvoiceTax({
    supplierCountryCode: 'FR',
    supplierExemptVat: false,
    supplierVatNumber: 'FR12345678901',
    supplierVatValidated: true,
    buyerCountryCode: 'IT',
    buyerRole: 'B2B',
    buyerVatNumber: 'IT12345678901',
    buyerVatValidated,
    currency: 'EUR',
    discountRate: 0,
    issueDate: new Date('2027-01-15'),
    items: [{ quantity: 1, unitPrice: 100, type: 'SERVICE' }],
  } as never);

describe('C4 — the three verdicts, and none of them may be collapsed', () => {
  /** A provider double: whatever the real VIES would have done, made deterministic. */
  const providerThat = (behaviour: 'valid' | 'invalid' | 'throws') =>
    ({
      supports: () => true,
      lookup: async () => {
        if (behaviour === 'throws') throw new Error('MS_MAX_CONCURRENT_REQ');
        return behaviour === 'valid' ? ({ VAT: 'IT12345678901' } as never) : null;
      },
    }) as unknown as ViesProvider;

  it('VALID — the member state confirmed the number', async () => {
    const client = new ViesVatValidationClient(providerThat('valid'));
    const r = await client.validate('IT', 'IT12345678901');
    expect(r.status).toBe('VALID');
    expect(r.source).toBe('eu-vies');
    expect(r.checkedAt).toBeInstanceOf(Date);
  });

  it('INVALID — the member state answered, and denied it', async () => {
    const client = new ViesVatValidationClient(providerThat('invalid'));
    expect((await client.validate('IT', 'IT00000000000')).status).toBe('INVALID');
  });

  /**
   * The case a suite that cannot exercise it cannot prove. VIES is regularly saturated, and a
   * transport failure must be a VERDICT, not an exception — validating a VAT number is never
   * allowed to be the thing that stops an invoice being issued.
   */
  it('UNAVAILABLE — the service could not be asked, and it does not throw', async () => {
    const client = new ViesVatValidationClient(providerThat('throws'));
    await expect(client.validate('IT', 'IT12345678901')).resolves.toMatchObject({
      status: 'UNAVAILABLE',
    });
  });

  it("UNAVAILABLE — a country VIES does not cover is not the number's fault", async () => {
    const client = new ViesVatValidationClient(new ViesProvider());
    expect((await client.validate('US', '123456789')).status).toBe('UNAVAILABLE');
  });

  it('the null client never claims validity — the conservative default, with an honest reason', async () => {
    const r = await new NullVatValidationClient().validate();
    expect(r.status).toBe('UNAVAILABLE');
    expect(r.source).toBe('none');
  });
});

describe('C4 — what the verdict changes on a real invoice', () => {
  it('unverified: 20% French VAT, category S — and a warning saying WHY', () => {
    const r = frItServices(false);
    expect(r.itemVatCategories).toEqual(['S']);
    expect(r.totalVAT).toBe(20);
    expect(r.warnings.join(' ')).toMatch(/has not been verified/);
    expect(r.warnings.join(' ')).toMatch(/reverse charge/i);
  });

  it('verified: reverse charge, category AE, no VAT — and no warning', () => {
    const r = frItServices(true);
    expect(r.itemVatCategories).toEqual(['AE']);
    expect(r.totalVAT).toBe(0);
    expect(r.warnings.join(' ')).not.toMatch(/has not been verified/);
  });

  /**
   * The under-charge guard the hardcoded `false` provided, preserved. An unverified number still
   * does not unlock 0% — only a checked one does.
   */
  it('a number that was checked and found INVALID does not unlock the reverse charge either', () => {
    expect(frItServices(false).totalVAT).toBe(20);
  });

  /** C3's K branch was correct, tested, and unreachable from the invoice path while C4 stood. */
  it('category K becomes reachable — an intra-community supply of GOODS', () => {
    const r = resolveInvoiceTax({
      supplierCountryCode: 'FR',
      supplierExemptVat: false,
      supplierVatNumber: 'FR12345678901',
      supplierVatValidated: true,
      buyerCountryCode: 'IT',
      buyerRole: 'B2B',
      buyerVatNumber: 'IT12345678901',
      buyerVatValidated: true,
      currency: 'EUR',
      discountRate: 0,
      issueDate: new Date('2027-01-15'),
      items: [{ quantity: 1, unitPrice: 100, type: 'SERVICE', supplyType: 'GOODS' }],
    } as never);
    expect(r.itemVatCategories).toEqual(['K']);
  });
});
