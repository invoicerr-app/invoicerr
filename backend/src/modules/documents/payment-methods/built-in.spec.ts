import { bankTransferPaymentMethod } from './bank-transfer.descriptor';
import { BUILT_IN_PAYMENT_METHODS } from './built-in';
import { cashPaymentMethod } from './cash.descriptor';
import { chequePaymentMethod } from './cheque.descriptor';
import { paypalPaymentMethod } from './paypal.descriptor';
import { stripePaymentMethod } from './stripe.descriptor';

describe('BUILT_IN_PAYMENT_METHODS', () => {
  it('ships exactly five methods, each a distinct, non-empty id', () => {
    const ids = BUILT_IN_PAYMENT_METHODS.map((m) => m.id);
    expect(ids).toEqual(['bank_transfer', 'paypal', 'cash', 'cheque', 'stripe']);
    expect(new Set(ids).size).toBe(5);
  });
});

describe('bankTransferPaymentMethod', () => {
  it('prints IBAN and BIC, in that order, when both are on file', () => {
    const result = bankTransferPaymentMethod.present({
      config: { iban: 'FR1420041010050500013M02606', bic: 'PSSTFRPPPAR' },
    });
    expect(result).toEqual({
      id: 'bank_transfer',
      label: 'Bank transfer',
      lines: ['IBAN: FR1420041010050500013M02606', 'BIC: PSSTFRPPPAR'],
    });
  });

  it('BIC is optional — an IBAN alone still presents cleanly', () => {
    const result = bankTransferPaymentMethod.present({ config: { iban: 'FR1420041010050500013M02606' } });
    expect(result.lines).toEqual(['IBAN: FR1420041010050500013M02606']);
  });

  it('never builds a `link` — a bank transfer has no such concept', () => {
    const result = bankTransferPaymentMethod.present({
      config: { iban: 'FR1420041010050500013M02606' },
      amountMinor: 12000,
      currency: 'EUR',
    });
    expect(result.link).toBeUndefined();
  });
});

describe('cashPaymentMethod — the empty case', () => {
  it('declares zero fields', () => {
    expect(cashPaymentMethod.fields).toEqual([]);
  });

  it('presents with only its own label — no lines, no link, regardless of context', () => {
    const result = cashPaymentMethod.present({ config: {}, amountMinor: 5000, currency: 'EUR' });
    expect(result).toEqual({ id: 'cash', label: 'Cash', lines: [] });
  });
});

describe('chequePaymentMethod', () => {
  it('prints the configured payee', () => {
    const result = chequePaymentMethod.present({ config: { payee: 'Acme SARL' } });
    expect(result).toEqual({ id: 'cheque', label: 'Cheque', lines: ['Payee: Acme SARL'] });
  });

  it('never builds a `link`', () => {
    const result = chequePaymentMethod.present({
      config: { payee: 'Acme SARL' },
      amountMinor: 5000,
      currency: 'EUR',
    });
    expect(result.link).toBeUndefined();
  });
});

describe('paypalPaymentMethod', () => {
  it('prints the configured e-mail and builds a classic hosted "Buy Now" link once an amount/currency is given', () => {
    const result = paypalPaymentMethod.present({
      config: { email: 'billing@acme.test' },
      amountMinor: 12050,
      currency: 'EUR',
      reference: 'INV-2026-0001',
    });
    expect(result.lines).toEqual(['PayPal e-mail: billing@acme.test']);
    expect(result.link).toBe(
      'https://www.paypal.com/cgi-bin/webscr?' +
        'cmd=_xclick&business=billing%40acme.test&amount=120.50&currency_code=EUR&item_name=INV-2026-0001',
    );
  });

  it('omits the link when there is no document context (amount/currency absent) — the screen preview case', () => {
    const result = paypalPaymentMethod.present({ config: { email: 'billing@acme.test' } });
    expect(result.link).toBeUndefined();
  });

  it('omits the link when no e-mail is configured at all', () => {
    const result = paypalPaymentMethod.present({ config: {}, amountMinor: 12000, currency: 'EUR' });
    expect(result.link).toBeUndefined();
    expect(result.lines).toEqual([]);
  });

  it('omits the link for a zero or negative amount — nothing to collect', () => {
    const result = paypalPaymentMethod.present({
      config: { email: 'billing@acme.test' },
      amountMinor: 0,
      currency: 'EUR',
    });
    expect(result.link).toBeUndefined();
  });
});

describe('stripePaymentMethod', () => {
  it('declares zero fields and never builds a link, even with a full document context', () => {
    expect(stripePaymentMethod.fields).toEqual([]);
    const result = stripePaymentMethod.present({ config: {}, amountMinor: 12000, currency: 'EUR' });
    expect(result).toEqual({ id: 'stripe', label: 'Stripe', lines: [] });
  });
});
