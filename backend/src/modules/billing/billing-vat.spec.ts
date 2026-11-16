import { vi } from 'vitest';

import { BILLING_FLAG_NAME } from './billing-flag';
import {
  applyVatMentionToInvoiceEvent,
  assertBillingVatConfiguredForBoot,
  readBillingVatMode,
  VAT_FRANCHISE_MENTION,
  VAT_REVERSE_CHARGE_MENTION,
  vatCheckoutSessionParams,
  vatCustomerCreateParams,
  vatFooterFor,
  vatFooterUpdate,
} from './billing-vat';

const REVERSE_CHARGE_TAXES = [{ taxability_reason: 'reverse_charge' }];
const STANDARD_TAXES = [{ taxability_reason: 'standard_rated' }];

describe('readBillingVatMode', () => {
  it('defaults to the franchise when BILLING_VAT is unset or blank', () => {
    expect(readBillingVatMode({})).toBe('franchise');
    expect(readBillingVatMode({ BILLING_VAT: '  ' })).toBe('franchise');
  });

  it.each([
    ['franchise', 'franchise'],
    ['charge', 'charge'],
    [' Charge ', 'charge'],
  ])('reads %j as %s', (raw, mode) => {
    expect(readBillingVatMode({ BILLING_VAT: raw })).toBe(mode);
  });

  it('refuses an unknown value rather than guessing a mode', () => {
    expect(() => readBillingVatMode({ BILLING_VAT: 'yes' })).toThrow(/BILLING_VAT must be/);
  });
});

describe('assertBillingVatConfiguredForBoot', () => {
  it('refuses to boot with billing enabled and an unknown BILLING_VAT', () => {
    expect(() =>
      assertBillingVatConfiguredForBoot({ [BILLING_FLAG_NAME]: 'true', BILLING_VAT: 'on' }),
    ).toThrow(/Refusing to boot/);
  });

  it('ignores BILLING_VAT while billing is disabled', () => {
    expect(() => assertBillingVatConfiguredForBoot({ BILLING_VAT: 'on' })).not.toThrow();
  });
});

describe('vatCustomerCreateParams', () => {
  it('puts the article 293 B mention on the customer invoices under the franchise', () => {
    expect(vatCustomerCreateParams('franchise')).toEqual({
      invoice_settings: { footer: 'TVA non applicable, art. 293 B du CGI' },
    });
  });

  it('adds nothing when VAT is charged', () => {
    expect(vatCustomerCreateParams('charge')).toEqual({});
  });
});

describe('vatCheckoutSessionParams', () => {
  it('leaves the checkout untouched under the franchise', () => {
    expect(vatCheckoutSessionParams('franchise')).toEqual({});
  });

  it('charges VAT through Stripe Tax, with an address and an optional VAT number', () => {
    expect(vatCheckoutSessionParams('charge')).toEqual({
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      customer_update: { address: 'auto', name: 'auto' },
    });
  });
});

describe('vatFooterFor', () => {
  it('always gives the franchise mention under the franchise, whatever the invoice', () => {
    expect(vatFooterFor('franchise', {})).toBe(VAT_FRANCHISE_MENTION);
    expect(vatFooterFor('franchise', { total_taxes: REVERSE_CHARGE_TAXES })).toBe(VAT_FRANCHISE_MENTION);
  });

  it('gives the reverse charge mention to an EU business invoice Stripe Tax reverse charged', () => {
    expect(vatFooterFor('charge', { total_taxes: REVERSE_CHARGE_TAXES })).toBe(VAT_REVERSE_CHARGE_MENTION);
    expect(VAT_REVERSE_CHARGE_MENTION).toMatch(/Autoliquidation/);
    expect(VAT_REVERSE_CHARGE_MENTION).toMatch(/283-2 du CGI/);
    expect(VAT_REVERSE_CHARGE_MENTION).toMatch(/196 de la directive 2006\/112\/CE/);
  });

  it('gives no footer to an invoice that charges VAT', () => {
    expect(vatFooterFor('charge', { total_taxes: STANDARD_TAXES })).toBe('');
    expect(vatFooterFor('charge', { total_taxes: null })).toBe('');
  });
});

describe('vatFooterUpdate', () => {
  it('writes nothing on an invoice that is no longer a draft', () => {
    expect(vatFooterUpdate('franchise', { status: 'open' })).toBeNull();
    expect(vatFooterUpdate('franchise', { status: 'paid' })).toBeNull();
  });

  it('writes nothing when the draft already carries the right footer', () => {
    expect(vatFooterUpdate('franchise', { status: 'draft', footer: VAT_FRANCHISE_MENTION })).toBeNull();
    expect(vatFooterUpdate('charge', { status: 'draft', footer: null })).toBeNull();
  });

  it('removes a franchise mention left by an older customer from an invoice that charges VAT', () => {
    expect(
      vatFooterUpdate('charge', {
        status: 'draft',
        footer: VAT_FRANCHISE_MENTION,
        total_taxes: STANDARD_TAXES,
      }),
    ).toBe('');
  });

  it('adds the franchise mention to a draft that has none', () => {
    expect(vatFooterUpdate('franchise', { status: 'draft', footer: null })).toBe(VAT_FRANCHISE_MENTION);
  });
});

describe('applyVatMentionToInvoiceEvent', () => {
  const invoiceCreated = (invoice: object) => ({ type: 'invoice.created', data: { object: invoice } });

  it('writes the mention on a draft invoice Stripe just created', async () => {
    const update = vi.fn().mockResolvedValue({});
    await applyVatMentionToInvoiceEvent(
      invoiceCreated({ id: 'in_1', status: 'draft', footer: null, total_taxes: REVERSE_CHARGE_TAXES }),
      'charge',
      update,
    );
    expect(update).toHaveBeenCalledWith('in_1', VAT_REVERSE_CHARGE_MENTION);
  });

  it('ignores every other event', async () => {
    const update = vi.fn();
    await applyVatMentionToInvoiceEvent(
      { type: 'invoice.finalized', data: { object: { id: 'in_1', status: 'draft' } } },
      'franchise',
      update,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('does not call Stripe when there is nothing to change', async () => {
    const update = vi.fn();
    await applyVatMentionToInvoiceEvent(invoiceCreated({ id: 'in_1', status: 'open' }), 'franchise', update);
    expect(update).not.toHaveBeenCalled();
  });

  it('lets a failed write throw, so Stripe retries the event', async () => {
    const update = vi.fn().mockRejectedValue(new Error('stripe down'));
    await expect(
      applyVatMentionToInvoiceEvent(invoiceCreated({ id: 'in_1', status: 'draft' }), 'franchise', update),
    ).rejects.toThrow('stripe down');
  });
});
