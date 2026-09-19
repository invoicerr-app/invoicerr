import { PaymentMethodDescriptor } from './types';

/**
 * "Stripe" — no configured field at all, and DELIBERATELY no `link` built by `present()` either
 * (unlike paypal.descriptor.ts, which builds one from a plain e-mail with no I/O). A real Stripe
 * "pay now" URL is a Checkout SESSION: single-use, amount-pinned AT CREATION TIME against a live,
 * authenticated call to Stripe's own API (`payments/payment-sessions.service.ts`'s own header,
 * point 1) — synthesizing one here, inside a PURE presentation function that might run while
 * rendering a PDF that gets cached, re-downloaded, or a follow-up email resent days later, would hand
 * out a link that is wrong, expired, or was never actually opened at the provider at all. Embedding
 * one would be actively wrong, not merely out of scope.
 *
 * The real "pay via Stripe" journey is unchanged by this feature: `PaymentSessionsService.
 * createInvoiceCheckoutSession`, reached through the client portal's own "Pay" action, still creates
 * a session on demand, the instant a payer actually wants to pay — this descriptor only ever marks
 * "this company accepts Stripe" (its own `enabled` flag, persistence.ts), never a
 * mechanism of its own for actually reaching a checkout page.
 */
export const stripePaymentMethod: PaymentMethodDescriptor = {
  id: 'stripe',
  label: 'Stripe',
  fields: [],
  present() {
    return { id: 'stripe', label: 'Stripe', lines: [] };
  },
};
