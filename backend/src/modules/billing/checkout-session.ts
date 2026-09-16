/**
 * Opens a Polar checkout session for THIS COMPANY — never a user (option A, product decision
 * 2026-09-16: one Polar customer PER COMPANY — see `billing-customer.ts`'s own header). Replaces
 * `@polar-sh/better-auth`'s own `checkout()` plugin route (used to be `POST /api/auth/checkout`,
 * removed from `polar-plugin.ts`, itself deleted): that plugin hard-codes
 * `externalCustomerId: session.user.id` with no request parameter able to override it (confirmed by
 * reading `@polar-sh/better-auth@1.8.4`'s own `dist/index.cjs` — its own `checkout()` docstring on
 * Polar's site states outright that neither `checkout()` nor `portal()` support a custom external
 * customer id), which is exactly wrong for a product that bills per COMPANY. `billing.controller.ts`'s
 * own `POST /billing/checkout` is the new route; `portal-session.ts` is this file's sibling for the
 * OTHER half of the same move.
 */
import {
  BillingCustomerClient,
  getOrCreatePolarCustomerForCompany,
  loadCompanyBillingIdentity,
} from './billing-customer';
import { getPolarClient } from './polar-client';

/** Narrow, mockable subset of the `Polar` SDK client this module calls — same convention every other
 *  billing file narrows its own client shape to (`portal-session.ts`/`seat-sync.spec.ts`). Extends
 *  `BillingCustomerClient` (rather than a separate, overlapping shape) because this module hands the
 *  SAME client straight through to `getOrCreatePolarCustomerForCompany` below. */
export interface CheckoutSessionClient extends BillingCustomerClient {
  checkouts: {
    create(request: {
      products: string[];
      externalCustomerId: string;
      metadata: Record<string, string>;
      successUrl?: string;
      returnUrl?: string;
    }): Promise<{ url: string }>;
  };
}

export interface CheckoutSessionResult {
  url: string;
  redirect: boolean;
}

export type CheckoutProductSlug = 'monthly' | 'yearly';

/** `POLAR_PRODUCT_ID_MONTHLY`/`POLAR_PRODUCT_ID_YEARLY` — the same two env vars
 *  `assertPolarEnvConfiguredForBoot` (`polar-env.ts`) already requires before this process ever boots
 *  with billing enabled, so a missing one here is unreachable in a real deployment; named defensively
 *  rather than handing `checkouts.create` an `undefined` product id and getting a less legible Polar
 *  rejection back. */
export function resolveCheckoutProductId(slug: CheckoutProductSlug): string {
  const envVar = slug === 'monthly' ? 'POLAR_PRODUCT_ID_MONTHLY' : 'POLAR_PRODUCT_ID_YEARLY';
  const productId = process.env[envVar];
  if (!productId) {
    throw new Error(`${envVar} is not configured — cannot start a "${slug}" checkout.`);
  }
  return productId;
}

export interface StartCheckoutParams {
  companyId: string;
  slug: CheckoutProductSlug;
  successUrl: string;
  returnUrl: string;
}

/**
 * `metadata.companyId` (never `referenceId` — that was `@polar-sh/better-auth`'s own checkout body
 * param, this call goes through the raw SDK and controls the key freely) is the FALLBACK the webhook
 * resolves a company from; the PRIMARY signal is the checkout's own `externalCustomerId`, which Polar
 * echoes back as `data.customer.external_id` on every subscription webhook (proven live in sandbox,
 * 2026-09-16 — see `webhook-handlers.ts`'s own header for the resolution order).
 */
export async function createCheckoutSession(
  params: StartCheckoutParams,
  client: CheckoutSessionClient = getPolarClient() as unknown as CheckoutSessionClient,
): Promise<CheckoutSessionResult> {
  const company = await loadCompanyBillingIdentity(params.companyId);
  await getOrCreatePolarCustomerForCompany(company, client);

  const checkout = await client.checkouts.create({
    products: [resolveCheckoutProductId(params.slug)],
    externalCustomerId: params.companyId,
    metadata: { companyId: params.companyId },
    successUrl: params.successUrl,
    returnUrl: params.returnUrl,
  });

  return { url: checkout.url, redirect: true };
}
