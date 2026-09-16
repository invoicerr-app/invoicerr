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
 *
 * TAX ID handling (dev-instance incident, 2026-09-16 — "Subscribe" opened a Polar checkout that
 * immediately answered "The provided tax ID is invalid."): `checkout-tax-id.ts#resolveCheckoutTaxId`
 * gates what this file even ATTEMPTS to send (never for an `exemptVat` company, never a value that
 * fails offline VAT syntax) — but a checksum-valid number can STILL be refused by Polar, which
 * validates against VIES (the EU's live VAT-registration lookup): a franchise-en-base trader is by
 * definition unregistered, so it has no VIES entry no matter how well-formed its VAT-shaped SIREN key
 * looks (traced live: `FR54982187676`, checksum-valid, VIES-absent). `createCheckoutSession` below
 * retries ONCE, without the tax id, on that specific 422 — the company keeps checking out, Polar's own
 * hosted form asks for the tax id again if it actually needs one — and reports the retry back to the
 * caller (`taxIdRejected`) so `billing.settings.tsx` can tell the owner why their VAT number did not
 * make it to Polar, rather than silently dropping it.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import {
  BillingCustomerClient,
  getOrCreatePolarCustomerForCompany,
  loadCompanyBillingIdentity,
} from './billing-customer';
import { resolveCheckoutTaxId } from './checkout-tax-id';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { getPolarClient } from './polar-client';
import { guessCountryCode } from '@/utils/country-name-to-iso';

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
      isBusinessCustomer?: boolean;
      customerBillingName?: string;
      customerBillingAddress?: {
        line1?: string | null;
        line2?: string | null;
        postalCode?: string | null;
        city?: string | null;
        state?: string | null;
        country: string;
      } | null;
      customerTaxId?: string | null;
    }): Promise<{ url: string }>;
  };
}

export interface CheckoutSessionResult {
  url: string;
  redirect: boolean;
  /** `true` only when this company HAD a syntactically valid, non-exempt VAT number on file and Polar
   *  still refused it (see this file's own header — the VIES-absent franchise-en-base case) — the
   *  checkout above went through anyway, on the automatic retry, WITHOUT it. Omitted (never `false`)
   *  on the ordinary path, so an existing frontend/spec destructuring only `{ url, redirect }` is
   *  unaffected. */
  taxIdRejected?: true;
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

export const CHECKOUT_ALREADY_ACTIVE_CODE = 'SUBSCRIPTION_ALREADY_ACTIVE';
export const CHECKOUT_IN_PROGRESS_CODE = 'CHECKOUT_ALREADY_IN_PROGRESS';

/** A second checkout is refused (never silently allowed to create a second Polar subscription) once
 *  this company already has a billable one — `ACTIVE` already folds Polar's own `trialing` status into
 *  it (`webhook-handlers.ts#mapPolarSubscriptionStatus`), so checking local `status` alone covers both
 *  "active" and "trialing" without a second Polar round-trip. */
export class SubscriptionAlreadyActiveError extends Error {
  readonly code = CHECKOUT_ALREADY_ACTIVE_CODE;

  constructor() {
    super('This company already has an active subscription — open the customer portal to manage it.');
    this.name = 'SubscriptionAlreadyActiveError';
  }
}

/** The window (from `lastCheckoutStartedAt`) inside which a SECOND checkout attempt is refused rather
 *  than opening a competing Polar checkout session for the same company — guards a double-click or a
 *  second browser tab, not a real re-attempt after actually abandoning the first (Polar's own checkout
 *  sessions this app does not track the real `expiresAt` of, so this is a short, deliberately
 *  conservative window rather than a claim about when the Polar session itself actually expires). */
export const CHECKOUT_IN_PROGRESS_WINDOW_MS = 10 * 60 * 1000;

export class CheckoutAlreadyInProgressError extends Error {
  readonly code = CHECKOUT_IN_PROGRESS_CODE;

  constructor() {
    super(
      'A checkout was already started for this company a moment ago — finish it, or wait a few minutes and retry.',
    );
    this.name = 'CheckoutAlreadyInProgressError';
  }
}

/** The company fields the checkout prefill needs on top of `loadCompanyBillingIdentity`'s own three —
 *  kept as its own narrow projection (never the full Prisma `Company` model) for the same "a spec never
 *  needs to construct a whole fake company row" reason `CompanyBillingIdentity` documents. */
export interface CheckoutBillingDetails {
  address: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  state: string | null;
  country: string;
  countryCode: string | null;
  /** `Company.exemptVat` — read here (rather than a separate query) because `resolveCheckoutTaxId`
   *  needs it in the SAME place it already needs `countryCode`. See `checkout-tax-id.ts`'s own header. */
  exemptVat: boolean;
}

async function loadCheckoutBillingDetails(
  companyId: string,
): Promise<{ details: CheckoutBillingDetails; vatNumber: string | null }> {
  const [company, vatIdentifier] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: {
        address: true,
        addressLine2: true,
        postalCode: true,
        city: true,
        state: true,
        country: true,
        countryCode: true,
        exemptVat: true,
      },
    }),
    prisma.partyIdentifier.findFirst({ where: { companyId, scheme: 'VAT' }, select: { value: true } }),
  ]);
  return { details: company, vatNumber: vatIdentifier?.value ?? null };
}

/** Polar is the OFFICIAL SELLER of record for this product (its own merchant-of-record model) — it is
 *  Polar, not this app, that needs the seller's own buyer's address/VAT number to compute the right
 *  VAT/reverse-charge treatment. Prefilling this at checkout (`customerBillingAddress`/`customerTaxId`,
 *  `checkoutcreate.d.ts` confirmed by reading `@polar-sh/sdk` directly) is what lets Polar get that
 *  right without asking the company to retype what it already told Invoicerr. Returns `null` when the
 *  company's own country cannot be resolved to a real ISO alpha-2 code (`guessCountryCode`) — Polar's
 *  `AddressInput.country` is a closed enum, so a company whose free-text `country` field guessed wrong
 *  gets NO prefilled address (Polar's own checkout form asks for it directly) rather than a fabricated
 *  code Polar would reject outright.
 */
function buildCheckoutCustomerFields(
  companyName: string,
  details: CheckoutBillingDetails,
  vatNumber: string | null,
): Pick<
  Parameters<CheckoutSessionClient['checkouts']['create']>[0],
  'isBusinessCustomer' | 'customerBillingName' | 'customerBillingAddress' | 'customerTaxId'
> {
  const countryCode = (details.countryCode || guessCountryCode(details.country))?.toUpperCase();
  const hasMinimalAddress = Boolean(countryCode && details.address && details.postalCode && details.city);

  return {
    // Every Invoicerr company is a business, never a private individual — this is what makes Polar
    // require the full billing address/name rather than just the country.
    isBusinessCustomer: true,
    customerBillingName: companyName,
    customerBillingAddress: hasMinimalAddress
      ? {
          line1: details.address,
          line2: details.addressLine2,
          postalCode: details.postalCode,
          city: details.city,
          state: details.state,
          country: countryCode as string,
        }
      : null,
    customerTaxId: vatNumber,
  };
}

/** Detects Polar's 422 refusal of the `customer_tax_id` field specifically (as opposed to some OTHER
 *  validation failure the SAME `HTTPValidationError` shape also carries) — checked on the `detail`
 *  array's own `loc`/`msg`, without importing `@polar-sh/sdk`'s own error class by name (same
 *  convention as `billing-customer.ts#isResourceNotFoundError`/`isEmailAlreadyExistsError`). Observed
 *  live in sandbox, 2026-09-16: `loc: ["body", "customer_tax_id"]`, `msg: "The provided tax ID is
 *  invalid."` for a checksum-valid FR VAT number with no active VIES entry (this file's own header). */
function isTaxIdInvalidError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { statusCode?: unknown; detail?: unknown };
  if (candidate.statusCode !== 422 || !Array.isArray(candidate.detail)) return false;
  return candidate.detail.some((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const entry = item as { loc?: unknown; msg?: unknown };
    const loc = Array.isArray(entry.loc) ? entry.loc : [];
    return (
      loc.some((seg) => typeof seg === 'string' && seg.includes('tax_id')) &&
      typeof entry.msg === 'string' &&
      /tax id/i.test(entry.msg)
    );
  });
}

/**
 * `metadata.companyId` (never `referenceId` — that was `@polar-sh/better-auth`'s own checkout body
 * param, this call goes through the raw SDK and controls the key freely) is the FALLBACK the webhook
 * resolves a company from; the PRIMARY signal is the checkout's own `externalCustomerId`, which Polar
 * echoes back as `data.customer.external_id` on every subscription webhook (proven live in sandbox,
 * 2026-09-16 — see `webhook-handlers.ts`'s own header for the resolution order).
 *
 * Refuses a SECOND concurrent checkout (`SubscriptionAlreadyActiveError`/`CheckoutAlreadyInProgressError`
 * — see their own headers) rather than letting two competing Polar checkout sessions exist for the same
 * company; stamps `lastCheckoutStartedAt` on success so the NEXT call can make that check.
 *
 * TAX ID: `resolveCheckoutTaxId` (`checkout-tax-id.ts`) decides whether a tax id is even attempted. If
 * one IS attempted and Polar still refuses it with the specific 422 `isTaxIdInvalidError` above detects
 * (the VIES-absent case, this file's own header), this retries ONCE, with the exact same request minus
 * `customerTaxId` — never for any OTHER refusal, which propagates unchanged. Any error the retry itself
 * throws also propagates unchanged: the automatic recovery is for this one named cause, not a general
 * "try again" around Polar.
 */
export async function createCheckoutSession(
  params: StartCheckoutParams,
  client: CheckoutSessionClient = getPolarClient() as unknown as CheckoutSessionClient,
): Promise<CheckoutSessionResult> {
  const sub = await getOrCreateCompanySubscription(params.companyId);
  if (sub.status === 'ACTIVE') {
    throw new SubscriptionAlreadyActiveError();
  }
  if (
    sub.lastCheckoutStartedAt &&
    Date.now() - sub.lastCheckoutStartedAt.getTime() < CHECKOUT_IN_PROGRESS_WINDOW_MS
  ) {
    throw new CheckoutAlreadyInProgressError();
  }

  const company = await loadCompanyBillingIdentity(params.companyId);
  await getOrCreatePolarCustomerForCompany(company, client);

  const { details, vatNumber } = await loadCheckoutBillingDetails(params.companyId);
  const taxId = resolveCheckoutTaxId({
    rawVatNumber: vatNumber,
    countryCode: details.countryCode,
    exemptVat: details.exemptVat,
  });

  const baseRequest = {
    products: [resolveCheckoutProductId(params.slug)],
    externalCustomerId: params.companyId,
    metadata: { companyId: params.companyId },
    successUrl: params.successUrl,
    returnUrl: params.returnUrl,
  };

  let checkout: { url: string };
  let taxIdRejected: true | undefined;
  try {
    checkout = await client.checkouts.create({
      ...baseRequest,
      ...buildCheckoutCustomerFields(company.name, details, taxId),
    });
  } catch (error) {
    if (!taxId || !isTaxIdInvalidError(error)) throw error;

    // Named, no secret: the tax id VALUE itself is never logged, only the fact that this company's
    // one was refused — see this file's own header for why a checksum-valid number can still land here.
    logger.warn(
      "Polar refused this company's VAT number as a checkout tax id (422) — retrying the checkout " +
        'without it. Likely cause: a checksum-valid number with no active VIES registration (e.g. a ' +
        'franchise-en-base trader) — see checkout-session.ts / checkout-tax-id.ts.',
      { category: 'billing', details: { companyId: params.companyId } },
    );
    taxIdRejected = true;
    checkout = await client.checkouts.create({
      ...baseRequest,
      ...buildCheckoutCustomerFields(company.name, details, null),
    });
  }

  await prisma.companySubscription.update({
    where: { companyId: params.companyId },
    data: { lastCheckoutStartedAt: new Date() },
  });

  return { url: checkout.url, redirect: true, ...(taxIdRejected ? { taxIdRejected } : {}) };
}
