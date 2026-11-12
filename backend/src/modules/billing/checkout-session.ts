/**
 * Opens a Polar checkout session for the company, via the raw SDK because `@polar-sh/better-auth`'s
 * `checkout()` hard-codes the session user as the external customer id.
 *
 * Polar validates tax ids against VIES, so a checksum-valid VAT number can still be refused (e.g. a
 * franchise-en-base trader). On that specific 422 the checkout is retried once without the tax id and
 * `taxIdRejected` tells the frontend why.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import {
  BillingCustomerClient,
  getOrCreatePolarCustomerForCompany,
  loadCompanyBillingIdentity,
} from './billing-customer';
import { resolveCheckoutTaxId } from './checkout-tax-id';
import {
  getOrCreateCompanySubscription,
  releaseCheckoutWindow,
  reserveCheckoutWindow,
} from './company-subscription.store';
import { invalidateCompanyCustomerFactsCache } from './legacy-customer';
import { getPolarClient } from './polar-client';
import { guessCountryCode } from '@/utils/country-name-to-iso';

/** Narrow, mockable subset of the Polar SDK client. Bodies use the wire's snake_case. */
export interface CheckoutSessionClient extends BillingCustomerClient {
  checkouts: {
    create(body: {
      products: string[];
      external_customer_id: string;
      metadata: Record<string, string>;
      success_url?: string;
      return_url?: string;
      is_business_customer?: boolean;
      customer_billing_name?: string;
      customer_billing_address?: {
        line1?: string | null;
        line2?: string | null;
        postal_code?: string | null;
        city?: string | null;
        state?: string | null;
        country: string;
      } | null;
      customer_tax_id?: string | null;
    }): Promise<{ url: string }>;
  };
}

export interface CheckoutSessionResult {
  url: string;
  redirect: boolean;
  /** Set when Polar refused the VAT number and the checkout went through without it. Omitted, never
   *  `false`, otherwise. */
  taxIdRejected?: true;
}

export type CheckoutProductSlug = 'monthly' | 'yearly';

export function resolveCheckoutProductId(slug: CheckoutProductSlug): string {
  const envVar = slug === 'monthly' ? 'POLAR_PRODUCT_ID_MONTHLY' : 'POLAR_PRODUCT_ID_YEARLY';
  const productId = process.env[envVar];
  if (!productId) {
    throw new Error(`${envVar} is not configured, cannot start a "${slug}" checkout.`);
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

/** Local `ACTIVE` already includes Polar's `trialing`, so no Polar round-trip is needed. */
export class SubscriptionAlreadyActiveError extends Error {
  readonly code = CHECKOUT_ALREADY_ACTIVE_CODE;

  constructor() {
    super('This company already has an active subscription, open the customer portal to manage it.');
    this.name = 'SubscriptionAlreadyActiveError';
  }
}

/** Guards double-clicks and second tabs; the real Polar session expiry is not tracked, so this is a
 *  conservative guess. */
export const CHECKOUT_IN_PROGRESS_WINDOW_MS = 10 * 60 * 1000;

export class CheckoutAlreadyInProgressError extends Error {
  readonly code = CHECKOUT_IN_PROGRESS_CODE;

  constructor() {
    super(
      'A checkout was already started for this company a moment ago, finish it, or wait a few minutes and retry.',
    );
    this.name = 'CheckoutAlreadyInProgressError';
  }
}

export interface CheckoutBillingDetails {
  address: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  state: string | null;
  country: string;
  countryCode: string | null;
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

/** Polar is merchant of record, so it needs the buyer's address and VAT number. The address is omitted
 *  when the country cannot be resolved to ISO alpha-2, since Polar's country field is a closed enum. */
function buildCheckoutCustomerFields(
  companyName: string,
  details: CheckoutBillingDetails,
  vatNumber: string | null,
): Pick<
  Parameters<CheckoutSessionClient['checkouts']['create']>[0],
  'is_business_customer' | 'customer_billing_name' | 'customer_billing_address' | 'customer_tax_id'
> {
  const countryCode = (details.countryCode || guessCountryCode(details.country))?.toUpperCase();
  const hasMinimalAddress = Boolean(countryCode && details.address && details.postalCode && details.city);

  return {
    // Makes Polar require the full billing address and name rather than just the country.
    is_business_customer: true,
    customer_billing_name: companyName,
    customer_billing_address: hasMinimalAddress
      ? {
          line1: details.address,
          line2: details.addressLine2,
          postal_code: details.postalCode,
          city: details.city,
          state: details.state,
          country: countryCode as string,
        }
      : null,
    customer_tax_id: vatNumber,
  };
}

/** Polar's 422 on `customer_tax_id` specifically, matched on `detail[].loc`/`msg` (nested under
 *  `.error`) without importing the SDK's error class. */
function isTaxIdInvalidError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { statusCode?: unknown; error?: { detail?: unknown } };
  const detail = candidate.error?.detail;
  if (candidate.statusCode !== 422 || !Array.isArray(detail)) return false;
  return detail.some((item) => {
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
 * `metadata.companyId` is only the webhook's fallback; the primary signal is `external_customer_id`,
 * echoed back as `data.customer.external_id`.
 *
 * The in-progress window is reserved atomically before calling Polar: two concurrent checkouts would
 * leave the first subscription billed with no reference stored. It is released if no checkout results.
 * The tax-id retry fires only for that specific 422; any other error, including from the retry, propagates.
 */
export async function createCheckoutSession(
  params: StartCheckoutParams,
  client: CheckoutSessionClient = getPolarClient() as unknown as CheckoutSessionClient,
): Promise<CheckoutSessionResult> {
  const sub = await getOrCreateCompanySubscription(params.companyId);
  if (sub.status === 'ACTIVE') {
    throw new SubscriptionAlreadyActiveError();
  }

  // A conditional write, not a check of `sub`, which is already stale under concurrency.
  const reservedAt = await reserveCheckoutWindow(params.companyId, CHECKOUT_IN_PROGRESS_WINDOW_MS);
  if (!reservedAt) {
    throw new CheckoutAlreadyInProgressError();
  }

  try {
    const company = await loadCompanyBillingIdentity(params.companyId);
    await getOrCreatePolarCustomerForCompany(company, client);
    // `hasCompanyCustomer` can flip to true here; drop this process's cached "no customer" answer.
    invalidateCompanyCustomerFactsCache(params.companyId);

    const { details, vatNumber } = await loadCheckoutBillingDetails(params.companyId);
    const taxId = resolveCheckoutTaxId({
      rawVatNumber: vatNumber,
      countryCode: details.countryCode,
      exemptVat: details.exemptVat,
    });

    const baseRequest = {
      products: [resolveCheckoutProductId(params.slug)],
      external_customer_id: params.companyId,
      metadata: { companyId: params.companyId },
      success_url: params.successUrl,
      return_url: params.returnUrl,
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

      // Never log the tax id value itself.
      logger.warn(
        "Polar refused this company's VAT number as a checkout tax id (422), retrying the checkout " +
          'without it. Likely cause: a checksum-valid number with no active VIES registration (e.g. a ' +
          'franchise-en-base trader), see checkout-session.ts / checkout-tax-id.ts.',
        { category: 'billing', companyId: params.companyId, details: { companyId: params.companyId } },
      );
      taxIdRejected = true;
      checkout = await client.checkouts.create({
        ...baseRequest,
        ...buildCheckoutCustomerFields(company.name, details, null),
      });
    }

    return { url: checkout.url, redirect: true, ...(taxIdRejected ? { taxIdRejected } : {}) };
  } catch (error) {
    await releaseCheckoutWindow(params.companyId, reservedAt);
    throw error;
  }
}
