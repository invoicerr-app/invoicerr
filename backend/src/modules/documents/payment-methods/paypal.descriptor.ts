import { decimalsFor, fromMinor } from '@/utils/financial';

import { PaymentMethodDescriptor, PaymentMethodRenderContext, presentFromFields } from './types';

/**
 * PayPal's own classic hosted "Buy Now" button URL (`cmd=_xclick`) — chosen DELIBERATELY over the
 * REST Orders API: it needs no API key/client secret at all (nothing here becomes a credential — see
 * persistence.ts's own header), just the receiving account's e-mail, so a company can start
 * accepting PayPal by typing one field, the same "no onboarding flow" property `bank_transfer`'s own
 * IBAN already has. It is a REDIRECT, not a webhook-verified payment: this repository has no way to
 * know a PayPal payment actually completed the way `payments/payment-sessions.service.ts` knows for
 * Stripe (a signed webhook) — recording that it arrived stays a "record-payment" action a human (or a
 * bank-reconciliation line) performs afterward, unchanged by this link existing at all.
 */
function buildPayPalLink(email: string, ctx: PaymentMethodRenderContext): string | undefined {
  if (ctx.amountMinor === undefined || ctx.currency === undefined) return undefined;
  if (!(ctx.amountMinor > 0)) return undefined;

  const amount = fromMinor(ctx.amountMinor, ctx.currency).toFixed(decimalsFor(ctx.currency));
  const params = new URLSearchParams({
    cmd: '_xclick',
    business: email,
    amount,
    currency_code: ctx.currency,
  });
  // "item_name" — the same reconciliation hint `sepa-qr.ts`'s own `remittance` field already attaches
  // to a SEPA transfer's payer-visible reference; optional, PayPal accepts the link without it.
  if (ctx.reference) params.set('item_name', ctx.reference);

  return `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
}

/**
 * "PayPal" — the account e-mail is both what gets PRINTED (the owner's own brief: "PayPal va afficher
 * le mail du compte") and what a "pay now" LINK is built from ("pourra générer un lien") — one field,
 * two uses, never a second one asked for. The link is OMITTED, not broken, whenever there is no
 * document amount/currency to anchor it to (the payment-methods screen's own preview, an unconfigured
 * e-mail) — see `PaymentMethodRenderContext`'s own header.
 */
export const paypalPaymentMethod: PaymentMethodDescriptor = {
  id: 'paypal',
  label: 'PayPal',
  fields: [{ key: 'email', kind: 'text', label: 'PayPal e-mail', required: true }],
  present(ctx) {
    const base = presentFromFields(paypalPaymentMethod, ctx.config);
    const email = typeof ctx.config.email === 'string' ? ctx.config.email : undefined;
    return { ...base, link: email ? buildPayPalLink(email, ctx) : undefined };
  },
};
