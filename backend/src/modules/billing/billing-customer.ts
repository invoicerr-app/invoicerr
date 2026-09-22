/**
 * Resolves — or, the first time, creates — THIS COMPANY's own Polar customer. Option A (product
 * decision 2026-09-16): one Polar customer PER COMPANY, `external_id = company.id`, never per user.
 * Replaces `@polar-sh/better-auth`'s own `createCustomerOnSignUp` (removed along with the rest of
 * `polar-plugin.ts` — see that file's own git history: it used to stamp a customer per USER at
 * sign-up, which is exactly wrong for a product that bills per company): a company's Polar customer
 * now comes into existence lazily, the first time it actually starts a checkout
 * (`checkout-session.ts`'s own caller), never at signup.
 *
 * Called EXPLICITLY before `checkouts.create` rather than relying on that call's own
 * `externalCustomerId` auto-create (confirmed in Polar's own `CheckoutCreate` type docstring: "if a
 * matching customer exists... otherwise, a new customer will be created with this external ID set") —
 * the only way to catch a duplicate-billing-email refusal as a clean, named error BEFORE a checkout
 * session opens, rather than an opaque failure mid-checkout.
 */
import prisma from '@/prisma/prisma.service';

import { getPolarClient } from './polar-client';

export const BILLING_EMAIL_TAKEN_CODE = 'BILLING_EMAIL_TAKEN';

/** Thrown when Polar refuses to create this company's customer because another customer in the SAME
 *  Polar organization already uses the resolved billing email — proven live in sandbox (2026-09-16):
 *  `customers.create` with a duplicate email answers 422 `HTTPValidationError`, `"A customer with
 *  this email address already exists"`, `loc: ["body", "email"]`. Two Invoicerr companies with the
 *  SAME contact `email` (one owner running several companies, e.g.) collide on the SECOND company's
 *  first checkout — `Company.billingEmail` (schema.prisma) is the escape hatch this error's own
 *  message points the OWNER at. */
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

/** The fields `resolveBillingEmail`/`getOrCreatePolarCustomerForCompany` actually read — a plain
 *  object rather than the full Prisma `Company` model, so a caller that already has these three
 *  fields (or a spec) never needs to construct a whole fake company row. */
export interface CompanyBillingIdentity {
  id: string;
  name: string;
  email: string;
  billingEmail: string | null;
}

/** `billingEmail` when set (trimmed, non-empty), else the company's own contact `email` — see
 *  `schema.prisma`'s own comment on `Company.billingEmail` for why this is opt-in, not a second
 *  mandatory field every company must fill in before ever checking out. */
export function resolveBillingEmail(company: CompanyBillingIdentity): string {
  const override = company.billingEmail?.trim();
  return override ? override : company.email;
}

/** Narrow, mockable subset of the `Polar` SDK client this module calls — same "structurally typed,
 *  not the SDK's own generated type" convention `portal-session.ts`/`seat-sync.spec.ts` already hold. */
export interface BillingCustomerClient {
  customers: {
    getExternal(request: { externalId: string }): Promise<{ id: string; type: string }>;
    create(request: {
      type: 'individual';
      externalId: string;
      email: string;
      name: string;
    }): Promise<{ id: string; type: string }>;
  };
}

/** Detects a Polar `ResourceNotFound` (404, "Get Customer by External ID" when no customer is
 *  registered under that external id yet) WITHOUT importing `@polar-sh/sdk`'s own `ResourceNotFound`
 *  class by name — `statusCode` is the one field every `PolarError` subclass carries
 *  (`node_modules/@polar-sh/sdk`'s own `models/errors/polarerror.js`, read directly), so this stays
 *  correct even if a future SDK bump renames the class. Exported for `legacy-customer.ts`'s own use
 *  (same detection, different caller). */
export function isResourceNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error as { statusCode: unknown }).statusCode === 404
  );
}

export const BILLING_EMAIL_MISSING_CODE = 'BILLING_EMAIL_MISSING';

/** Thrown BEFORE this module ever calls Polar when neither `Company.billingEmail` nor `Company.email`
 *  resolves to anything (`resolveBillingEmail` returns `''`) — the live incident this class exists to
 *  prevent: `checkout-session.ts` used to hand that empty string straight to
 *  `client.customers.create`, Polar refused it (422, `"An email address must have an @-sign"`), and
 *  nothing on the checkout path caught THAT specific refusal, so Nest's own default exception handler
 *  turned it into an opaque 500. `billing.controller.ts`'s own `startCheckout`/`openPortal` catch
 *  blocks turn this into a 422 (`UnprocessableEntityException`, see that file's own comment on why
 *  422 rather than 409) the frontend shows VERBATIM (`billing.settings.tsx`'s generic
 *  `error.message` fallback — there is deliberately no separate, translated override for this one
 *  code the way `BILLING_EMAIL_TAKEN` gets: the whole point of this class's own wording is that it
 *  IS what reaches the screen). Reuses the exact "empty" check `customer-provisioning.ts`'s
 *  boot/sweep pass already established (`!resolveBillingEmail(company)`) rather than inventing a
 *  second notion of "empty" for the same fact. */
export class MissingBillingEmailError extends Error {
  readonly code = BILLING_EMAIL_MISSING_CODE;

  constructor() {
    super(
      'This company has no billing email address on file. Set one in Settings > Billing, then try again.',
    );
    this.name = 'MissingBillingEmailError';
  }
}

/** Detects the specific 422 "email already exists" refusal (as opposed to some OTHER validation
 *  failure a malformed request could also get back as an `HTTPValidationError`) — checked on the
 *  `detail` array's own `loc`/`msg`, the exact shape `@polar-sh/sdk`'s `HTTPValidationError` carries,
 *  again without importing that class by name (see `isResourceNotFoundError`'s own comment). */
function isEmailAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { statusCode?: unknown; detail?: unknown };
  if (candidate.statusCode !== 422 || !Array.isArray(candidate.detail)) return false;
  return candidate.detail.some((item) => {
    if (typeof item !== 'object' || item === null) return false;
    const entry = item as { loc?: unknown; msg?: unknown };
    const loc = Array.isArray(entry.loc) ? entry.loc : [];
    return loc.includes('email') && typeof entry.msg === 'string' && /already exists/i.test(entry.msg);
  });
}

/**
 * Gets this company's own Polar customer, creating it the first time (`type: 'individual'` — Polar
 * itself promotes it to `type: 'team'` automatically on the company's first seat-based checkout, see
 * `portal-session.ts`'s own header for that observed chain; never created as `'team'` up front, there
 * is no second Invoicerr-side member to seed it with).
 */
export async function getOrCreatePolarCustomerForCompany(
  company: CompanyBillingIdentity,
  client: BillingCustomerClient = getPolarClient() as unknown as BillingCustomerClient,
): Promise<{ id: string; type: string }> {
  try {
    return await client.customers.getExternal({ externalId: company.id });
  } catch (error) {
    if (!isResourceNotFoundError(error)) throw error;
  }

  const email = resolveBillingEmail(company);
  // Refuses BEFORE ever calling Polar — see `MissingBillingEmailError`'s own header for the live 500
  // this guard replaces. `customer-provisioning.ts`'s own boot/sweep pass already checks this same
  // condition before EVER calling this function at all (so this branch never fires from that caller —
  // defense in depth, same discipline `member-sync.ts`'s own header names for its warm-cache calls);
  // this is the guard for `checkout-session.ts`, the caller that had none.
  if (!email) throw new MissingBillingEmailError();
  try {
    return await client.customers.create({
      type: 'individual',
      externalId: company.id,
      email,
      name: company.name,
    });
  } catch (error) {
    if (isEmailAlreadyExistsError(error)) throw new BillingEmailTakenError(email);
    throw error;
  }
}

/** Reads exactly the fields `getOrCreatePolarCustomerForCompany` needs — the one place this module
 *  touches Prisma, so `checkout-session.ts` never has to (controllers/orchestrators call THIS, not
 *  `prisma.company` directly, same layering `CLAUDE.md` asks for everywhere else). */
export async function loadCompanyBillingIdentity(companyId: string): Promise<CompanyBillingIdentity> {
  return prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { id: true, name: true, email: true, billingEmail: true },
  });
}
