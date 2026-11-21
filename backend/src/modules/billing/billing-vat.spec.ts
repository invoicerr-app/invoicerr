import { vi } from 'vitest';

import { BILLING_FLAG_NAME } from './billing-flag';
import {
  type CompanyTaxProfile,
  type CustomerVatClient,
  customerVatFooter,
  isReverseChargeCompany,
  stripeEuVatValue,
  syncCustomerForCheckout,
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

  it('charges VAT through Stripe Tax and never lets Checkout rewrite the synced customer', () => {
    expect(vatCheckoutSessionParams('charge')).toEqual({
      automatic_tax: { enabled: true },
      customer_update: { address: 'never', name: 'never' },
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

const profile = (countryCode: string | null, vat: CompanyTaxProfile['vat']): CompanyTaxProfile => ({
  address: { line1: '1 Hauptstrasse', postalCode: '10115', city: 'Berlin', countryCode },
  vat,
});
const VALID_DE = profile('DE', { value: 'DE123456789', validationStatus: 'VALID' });

describe('isReverseChargeCompany', () => {
  it('is true for a company in another EU member state with a VAT number validated by VIES', () => {
    expect(isReverseChargeCompany(VALID_DE)).toBe(true);
  });

  it.each([
    ['a French company', profile('FR', { value: 'FR12345678901', validationStatus: 'VALID' })],
    ['a VAT number not validated', profile('DE', { value: 'DE123456789', validationStatus: null })],
    ['an invalid VAT number', profile('DE', { value: 'DE123456789', validationStatus: 'INVALID' })],
    ['VIES unavailable', profile('DE', { value: 'DE123456789', validationStatus: 'UNAVAILABLE' })],
    ['no VAT number', profile('DE', null)],
    ['a company outside the EU', profile('CH', { value: 'CHE123456789', validationStatus: 'VALID' })],
    ['an unknown country', profile(null, { value: 'DE123456789', validationStatus: 'VALID' })],
  ])('is false for %s', (_name, p) => {
    expect(isReverseChargeCompany(p)).toBe(false);
  });
});

describe('customerVatFooter', () => {
  it('is the franchise mention for every company under the franchise', () => {
    expect(customerVatFooter('franchise', VALID_DE)).toBe(VAT_FRANCHISE_MENTION);
    expect(customerVatFooter('franchise', null)).toBe(VAT_FRANCHISE_MENTION);
  });

  it('is the reverse charge mention for a reverse charged company, none otherwise', () => {
    expect(customerVatFooter('charge', VALID_DE)).toBe(VAT_REVERSE_CHARGE_MENTION);
    expect(customerVatFooter('charge', profile('FR', null))).toBe('');
  });
});

describe('stripeEuVatValue', () => {
  it('keeps a prefixed number, strips spaces and dots', () => {
    expect(stripeEuVatValue(profile('DE', { value: 'de 123.456.789', validationStatus: 'VALID' }))).toBe(
      'DE123456789',
    );
  });

  it('adds the country prefix, EL for Greece', () => {
    expect(stripeEuVatValue(profile('IT', { value: '12345678901', validationStatus: 'VALID' }))).toBe(
      'IT12345678901',
    );
    expect(stripeEuVatValue(profile('GR', { value: '123456789', validationStatus: 'VALID' }))).toBe(
      'EL123456789',
    );
  });
});

describe('syncCustomerForCheckout', () => {
  function recordingClient(existing: Array<{ id: string; type: string; value: string }> = []) {
    const calls: unknown[][] = [];
    const client: CustomerVatClient = {
      updateCustomer: async (...args) => calls.push(['update', ...args]),
      listTaxIds: async () => existing,
      createTaxId: async (...args) => calls.push(['createTaxId', ...args]),
      deleteTaxId: async (...args) => calls.push(['deleteTaxId', ...args]),
    };
    return { calls, client };
  }

  it('writes only the franchise footer under the franchise', async () => {
    const { calls, client } = recordingClient();
    await syncCustomerForCheckout('franchise', 'cus_1', VALID_DE, client);
    expect(calls).toEqual([['update', 'cus_1', { invoice_settings: { footer: VAT_FRANCHISE_MENTION } }]]);
  });

  it('gives a reverse charged company its mention, address and EU VAT number', async () => {
    const { calls, client } = recordingClient();
    await syncCustomerForCheckout('charge', 'cus_1', VALID_DE, client);
    expect(calls).toEqual([
      [
        'update',
        'cus_1',
        {
          invoice_settings: { footer: VAT_REVERSE_CHARGE_MENTION },
          address: {
            line1: '1 Hauptstrasse',
            line2: undefined,
            postal_code: '10115',
            city: 'Berlin',
            state: undefined,
            country: 'DE',
          },
        },
      ],
      ['createTaxId', 'cus_1', { type: 'eu_vat', value: 'DE123456789' }],
    ]);
  });

  it('does not add the EU VAT number twice', async () => {
    const { calls, client } = recordingClient([{ id: 'txi_1', type: 'eu_vat', value: 'DE123456789' }]);
    await syncCustomerForCheckout('charge', 'cus_1', VALID_DE, client);
    expect(calls.map((c) => c[0])).toEqual(['update']);
  });

  it('removes an EU VAT number that would let Stripe reverse charge an invoice with no mention', async () => {
    const notValidated = profile('DE', { value: 'DE123456789', validationStatus: null });
    const { calls, client } = recordingClient([{ id: 'txi_1', type: 'eu_vat', value: 'DE123456789' }]);
    await syncCustomerForCheckout('charge', 'cus_1', notValidated, client);
    expect(calls[0]).toMatchObject(['update', 'cus_1', { invoice_settings: { footer: '' } }]);
    expect(calls.slice(1)).toEqual([['deleteTaxId', 'cus_1', 'txi_1']]);
  });
});
