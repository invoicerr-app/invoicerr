/**
 * Opens a Polar customer-portal session for THIS COMPANY — never a user (option A, product decision
 * 2026-09-16: one Polar customer PER COMPANY, `external_id = company.id` — see `billing-customer.ts`'s
 * own header). NOT via `@polar-sh/better-auth`'s own `portal()` plugin route (removed along with the
 * rest of `polar-plugin.ts`), because that route was unconditionally broken for THIS product even
 * before the per-company move: read directly (`node_modules/@polar-sh/better-auth/dist/index.cjs`'s
 * `portal` endpoint), it always calls
 * `polar2.customerSessions.create({ externalCustomerId: session.user.id, returnUrl })` — no `memberId`,
 * no way to configure one, hard-coded to the SESSION USER besides. Polar rejects a `memberId`-less call
 * with `"member_id is required for team customers"` for a TEAM customer — re-confirmed live in sandbox
 * 2026-09-17 with a fresh team customer created for this exact question: `customerSessions.create`
 * with only `customerId` (no `memberId`) answers 422 `"member_id is required for team customers"`, so
 * there is no `memberId`-less path to fall back to for a TEAM customer, ever. This product's hosted
 * plan IS seat-based (`POLAR_PRODUCT_ID_MONTHLY`/`YEARLY` are `amountType: "seat_based"` prices,
 * confirmed by reading the live sandbox products 2026-09-15) — and Polar's own model requires a
 * customer that checks out against a seat-based price to be a TEAM customer (so seats can be assigned
 * to individual members), regardless of what `type` the customer row started as. Confirmed live in
 * sandbox: a paying company's Polar customer reads back `type: "team"` with exactly one
 * Polar-auto-created `role: "owner"` member.
 *
 * The `memberId` this file resolves is `member-resolution.ts#resolveOrCreateCompanyBillingMemberId`'s
 * — the ONE member standing for the COMPANY's own billing identity — NOT the clicking user's own
 * member. An earlier version of this function (2026-09-16's "multi-user follow-up") opened the session
 * for whichever OWNER/ADMIN was clicking; a real dev-instance incident (2026-09-17) showed the portal
 * page then carrying THAT user's own personal login email instead of the company's billing email
 * (`https://…/portal/overview?…&email=<clicking user>`, confirmed by a live, unmodified sandbox call
 * that `email=` in `customerPortalUrl` comes straight from Polar's own response — nothing in this
 * codebase appends it) — wrong for a product whose customer IS the company, not any one of its users.
 * Reachable only for OWNER/ADMIN in the first place (`@Roles` on `billing.controller.ts`'s own
 * `POST /billing/portal`) — a plain MEMBER never calls this at all; which specific OWNER/ADMIN clicked
 * no longer changes what the portal opens as.
 *
 * `individual` customers (a company that has never completed a checkout yet, so Polar never promoted
 * it to `team`) keep working with a plain `externalCustomerId` call, no `memberId` — proven in sandbox
 * (2026-09-16) for a customer with no `memberId` supplied at all.
 *
 * A company with NO Polar customer at all yet (never started a checkout — the common case for a
 * TRIAL company) reads as `PolarCustomerNotFoundError` below rather than an unhandled SDK rejection —
 * `billing.controller.ts` turns that into a plain 404 the frontend already has a generic error toast
 * for.
 */
import { isResourceNotFoundError } from './billing-customer';
import {
  CompanyBillingMemberIdentity,
  MemberResolutionClient,
  ResolvedMemberUser,
  resolveOrCreateCompanyBillingMemberId,
  resolveOrCreateMemberIdForUser,
} from './member-resolution';
import { getPolarClient } from './polar-client';

/** Structurally typed subset of the `Polar` SDK client this function actually calls — the same
 *  "narrow, mockable client shape" `seat-sync.spec.ts` already exercises against `getPolarClient()`,
 *  rather than importing the SDK's full generated `Polar` type here. Extends `MemberResolutionClient`
 *  because a TEAM customer needs that module's own member lookup/creation. */
export interface PortalSessionClient extends MemberResolutionClient {
  customers: MemberResolutionClient['customers'] & {
    getExternal(request: { externalId: string }): Promise<{ id: string; type: string }>;
  };
  customerSessions: {
    create(request: {
      customerId?: string;
      externalCustomerId?: string;
      memberId?: string;
      returnUrl?: string;
    }): Promise<{ customerPortalUrl: string }>;
  };
}

export interface PortalSessionResult {
  url: string;
  redirect: boolean;
}

/** Named the same way every other business-state refusal in this module family is
 *  (`BillingEmailTakenError`'s own `BILLING_EMAIL_TAKEN_CODE`, `checkout-session.ts`'s two codes) — a
 *  `{ message, code }` shape `billing.controller.ts` turns into a 409 the frontend can branch on,
 *  instead of the raw message a real dev-instance incident (2026-09-16) proved was reaching the user
 *  verbatim as a toast. */
export const BILLING_NO_COMPANY_CUSTOMER_CODE = 'BILLING_NO_COMPANY_CUSTOMER';

/** Thrown when this company has no Polar customer at all yet — a TRIAL company that never started a
 *  checkout (`getOrCreatePolarCustomerForCompany` is only ever called from `checkout-session.ts`, so a
 *  company can genuinely reach "open the portal" first — `customer-provisioning.ts`'s boot/sweep sync
 *  narrows this to the email-taken case going forward, but never fully closes it). `billing.controller.ts`
 *  turns this into a named 409. Also reused, keyed by USER id instead of company id, by
 *  `createLegacyCustomerPortalSession` below. */
export class PolarCustomerNotFoundError extends Error {
  readonly code = BILLING_NO_COMPANY_CUSTOMER_CODE;

  constructor(readonly externalId: string) {
    super(`No Polar customer registered at external id "${externalId}" yet — nothing to manage.`);
    this.name = 'PolarCustomerNotFoundError';
  }
}

/**
 * The `customers.getExternal` → team-or-individual → `customerSessions.create` dance both portal
 * functions below need, parameterized only by WHOSE external id the customer is filed under and HOW to
 * resolve a `memberId` for a TEAM customer — the one thing that differs between "the company's own
 * billing identity" (`createCustomerPortalSession`) and "the pre-migration customer's own user"
 * (`createLegacyCustomerPortalSession`). Not exported — both callers below already have the identity
 * they need before calling in, so a THIRD, generic entry point would only invite a caller to pass the
 * wrong one.
 */
async function openPortalSessionFor(
  externalId: string,
  resolveMemberId: (client: PortalSessionClient, customerId: string) => Promise<string>,
  returnUrl: string,
  client: PortalSessionClient,
): Promise<PortalSessionResult> {
  let customer: { id: string; type: string };
  try {
    customer = await client.customers.getExternal({ externalId });
  } catch (error) {
    if (isResourceNotFoundError(error)) throw new PolarCustomerNotFoundError(externalId);
    throw error;
  }

  const session =
    customer.type === 'team'
      ? await client.customerSessions.create({
          customerId: customer.id,
          memberId: await resolveMemberId(client, customer.id),
          returnUrl,
        })
      : await client.customerSessions.create({ externalCustomerId: externalId, returnUrl });

  return { url: session.customerPortalUrl, redirect: true };
}

/**
 * `companyId` is what `checkout-session.ts`'s own `getOrCreatePolarCustomerForCompany` already stamps
 * as the Polar customer's `externalId` (option A, `billing-customer.ts`'s own header). `billing` is
 * the COMPANY's own billing identity (`billing-customer.ts#resolveBillingEmail` + the company's name),
 * never the clicking user's — see this file's own header on why. `returnUrl` mirrors
 * `portal-return-url.ts`'s `FALLBACK_RETURN_URL()` — passed in rather than re-read from `process.env`
 * here so this function stays a pure client call, easy to unit test without env plumbing.
 */
export function createCustomerPortalSession(
  companyId: string,
  billing: CompanyBillingMemberIdentity,
  returnUrl: string,
  client: PortalSessionClient = getPolarClient() as unknown as PortalSessionClient,
): Promise<PortalSessionResult> {
  return openPortalSessionFor(
    companyId,
    (c, customerId) => resolveOrCreateCompanyBillingMemberId(c, customerId, companyId, billing),
    returnUrl,
    client,
  );
}

/**
 * Opens a portal session for the pre-2026-09-16 per-USER Polar customer a `legacySubscription: true`
 * company's OWNER/ADMIN needs to cancel by hand (there is no Polar API to migrate a subscription onto
 * the new company-scoped customer — see `legacy-customer.ts`'s own header). Keyed by the CLICKING
 * user's own id and resolved via `member-resolution.ts#resolveOrCreateMemberIdForUser` — UNLIKE
 * `createCustomerPortalSession` above, there is no "company billing identity" to open this one under:
 * the customer itself IS this one user, by construction, so the member matching them is correct here
 * in a way it stopped being correct for the company-scoped portal. Throws the SAME
 * `PolarCustomerNotFoundError` (keyed by `user.id` this time) when no Polar customer is registered at
 * all under this user's id — `billing.controller.ts`'s own `POST /billing/portal/legacy` turns that
 * into the same named 409 `POST /billing/portal` does. `billing.settings.tsx` avoids ever hitting this
 * in the first place by checking `legacyPortalAvailable` (`legacy-customer.ts#hasLegacyPolarCustomer`)
 * before rendering the link at all — this is the button's own click-time safety net, not the primary
 * gate.
 */
export function createLegacyCustomerPortalSession(
  user: ResolvedMemberUser,
  returnUrl: string,
  client: PortalSessionClient = getPolarClient() as unknown as PortalSessionClient,
): Promise<PortalSessionResult> {
  return openPortalSessionFor(
    user.id,
    (c, customerId) => resolveOrCreateMemberIdForUser(c, customerId, user.id, user),
    returnUrl,
    client,
  );
}
