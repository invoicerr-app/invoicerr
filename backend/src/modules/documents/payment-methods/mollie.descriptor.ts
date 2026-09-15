import { PaymentMethodDescriptor } from './types';

/**
 * "Mollie" — same trivial shape as `stripe.descriptor.ts`, and for the identical reason: no configured
 * field, no `link` built by `present()`. A real Mollie "pay now" URL is a Payment's own `_links.
 * checkout.href` — single-use, amount-pinned AT CREATION TIME against a live, authenticated call to
 * Mollie's own API (`payments/providers/mollie/mollie-provider.ts`'s own header) — synthesizing one
 * here, inside a PURE presentation function that might run while rendering a PDF that gets cached,
 * re-downloaded, or a follow-up email resent days later, would hand out a link that is wrong, expired,
 * or was never actually opened at the provider at all.
 *
 * The real "pay via Mollie" journey is unchanged by this descriptor: `PaymentSessionsService.
 * createInvoiceCheckoutSession`, reached through the client portal's own "Pay" action, still creates a
 * session on demand — this descriptor only ever marks "this company accepts Mollie" (its own `enabled`
 * flag, persistence.ts), never a mechanism of its own for actually reaching a checkout page.
 */
export const molliePaymentMethod: PaymentMethodDescriptor = {
  id: 'mollie',
  label: 'Mollie',
  fields: [],
  present() {
    return { id: 'mollie', label: 'Mollie', lines: [] };
  },
};
