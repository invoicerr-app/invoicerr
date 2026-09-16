/** `POST /api/billing/checkout` — matches one of the two `POLAR_PRODUCT_ID_MONTHLY`/`YEARLY` products
 *  (`checkout-session.ts#resolveCheckoutProductId`). No `referenceId`/company id here — the ACTIVE
 *  COMPANY is resolved server-side (`@ActiveCompany()`), never trusted from the client (option A,
 *  `checkout-session.ts`'s own header on why this differs from the removed better-auth checkout body). */
export interface StartCheckoutDto {
  slug: 'monthly' | 'yearly';
  successUrl: string;
  returnUrl: string;
}

/** `PUT /api/billing/billing-email` — see `billing-email.ts`'s own header. `null` (or omitted) clears
 *  the override back to "use the company's own contact email". */
export interface SetBillingEmailDto {
  billingEmail?: string | null;
}
