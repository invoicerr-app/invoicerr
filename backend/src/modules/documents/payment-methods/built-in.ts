import { bankTransferPaymentMethod } from './bank-transfer.descriptor';
import { cashPaymentMethod } from './cash.descriptor';
import { chequePaymentMethod } from './cheque.descriptor';
import { paypalPaymentMethod } from './paypal.descriptor';
import { stripePaymentMethod } from './stripe.descriptor';
import { PaymentMethodDescriptor } from './types';

/**
 * Every payment method this repository ships, in the order a company's own settings screen offers
 * them — the SAME list `payment-method-registry.ts#buildPaymentMethodRegistry` registers and
 * `invoice.descriptor.ts`'s own `record-payment.method` options are generated from, so the two can
 * never drift apart (one list, read twice). Adding a SIXTH method is exactly one more entry here plus
 * its own descriptor file — no controller change, no frontend screen change (both only ever iterate
 * whatever this list (via the registry) contains).
 *
 * "bank_transfer" and "cash" REUSE, unchanged, two of the four ids `record-payment`'s own hardcoded
 * `method` select used to offer before this feature — see each descriptor's own header on why: an
 * existing `DocumentPayment.method` of either value already resolves to the matching new descriptor,
 * with no data migration of its own. The other two old ids ("card", "other") are NOT reused by any
 * built-in method here — they were product-only, no-information labels with nothing to configure, and
 * this feature replaces them with genuinely distinct methods (Stripe, for an actual card-payment
 * provider; nothing replaces the totally generic "other") rather than pretending either mapped to one
 * new id. An EXISTING payment recorded with `method: "card"` or `method: "other"` still reads back and
 * renders exactly as it always did (the raw string, verbatim — see settlement/payments.ts, unchanged);
 * it is simply no longer offered as a choice for a NEW one, the same way a removed `select` option
 * anywhere else in this codebase stops being offered without invalidating data already on file.
 */
export const BUILT_IN_PAYMENT_METHODS: PaymentMethodDescriptor[] = [
  bankTransferPaymentMethod,
  paypalPaymentMethod,
  cashPaymentMethod,
  chequePaymentMethod,
  stripePaymentMethod,
];
