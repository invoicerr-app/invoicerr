/**
 * One Polar customer per company (`external_id = company.id`), created lazily on first checkout.
 * Created explicitly rather than via `checkouts.create`'s auto-create so a duplicate-email refusal
 * surfaces as a named error before the checkout session opens.
 */
import prisma from '@/prisma/prisma.service';

import { getPolarClient } from './polar-client';

export const BILLING_EMAIL_TAKEN_CODE = 'BILLING_EMAIL_TAKEN';

/** Polar refuses (422) a second customer with the same email in one organization, e.g. two companies
 *  sharing a contact email; `Company.billingEmail` is the escape hatch. */
export class BillingEmailTakenError extends Error {
  readonly code = BILLING_EMAIL_TAKEN_CODE;

  constructor(readonly email: string) {
    super(
      `Polar already has a customer using "${email}" as its billing email. Choose a distinct billing ` +
        'email for this company (Settings > Billing).',
    );
    this.name = 'BillingEmailTakenError';
  }
}

export interface CompanyBillingIdentity {
  id: string;
  name: string;
  email: string;
  billingEmail: string | null;
}

/** Trimmed `billingEmail` when set, else the company's contact `email`. */
export function resolveBillingEmail(company: CompanyBillingIdentity): string {
  const override = company.billingEmail?.trim();
  return override ? override : company.email;
}

/** Narrow, mockable subset of the Polar SDK client. `create` takes the wire's snake_case body. */
export interface BillingCustomerClient {
  customers: {
    getExternal(externalId: string): Promise<{ id: string; type: string }>;
    create(body: {
      type: 'individual';
      external_id: string;
      email: string;
      name: string;
    }): Promise<{ id: string; type: string }>;
  };
}

/** Checks `statusCode` rather than the SDK's `ResourceNotFound` class so a class rename cannot break it. */
export function isResourceNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode: unknown }).statusCode === 404
  );
}

export const BILLING_EMAIL_MISSING_CODE = 'BILLING_EMAIL_MISSING';

/** Thrown before calling Polar, which would otherwise reject an empty email with an opaque 500. The
 *  message is shown verbatim in the frontend, so keep it user-facing. */
export class MissingBillingEmailError extends Error {
  readonly code = BILLING_EMAIL_MISSING_CODE;

  constructor() {
    super(
      'This company has no billing email address on file. Set one in Settings > Billing, then try again.',
    );
    this.name = 'MissingBillingEmailError';
  }
}

/** Distinguishes the duplicate-email 422 from other validation failures; the SDK nests the parsed
 *  body under `.error`, not a top-level `.detail`. */
function isEmailAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { statusCode?: unknown; error?: { detail?: unknown } };
  const detail = candidate.error?.detail;
  if (candidate.statusCode !== 422 || !Array.isArray(detail)) return false;
  return detail.some((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const entry = item as { loc?: unknown; msg?: unknown };
    const loc = Array.isArray(entry.loc) ? entry.loc : [];
    return loc.includes('email') && typeof entry.msg === 'string' && /already exists/i.test(entry.msg);
  });
}

/** Created as `individual`; Polar itself promotes it to `team` on the first seat-based checkout. */
export async function getOrCreatePolarCustomerForCompany(
  company: CompanyBillingIdentity,
  client: BillingCustomerClient = getPolarClient() as unknown as BillingCustomerClient,
): Promise<{ id: string; type: string }> {
  try {
    return await client.customers.getExternal(company.id);
  } catch (error) {
    if (!isResourceNotFoundError(error)) throw error;
  }

  const email = resolveBillingEmail(company);
  // Defense in depth: provisioning already checks this, but checkout does not.
  if (!email) throw new MissingBillingEmailError();
  try {
    return await client.customers.create({
      type: 'individual',
      external_id: company.id,
      email,
      name: company.name,
    });
  } catch (error) {
    if (isEmailAlreadyExistsError(error)) throw new BillingEmailTakenError(email);
    throw error;
  }
}

export async function loadCompanyBillingIdentity(companyId: string): Promise<CompanyBillingIdentity> {
  return prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { id: true, name: true, email: true, billingEmail: true },
  });
}
