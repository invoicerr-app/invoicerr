/**
 * Opens a Polar customer-portal session for THIS COMPANY — never a user (option A, product decision
 * 2026-09-16: one Polar customer PER COMPANY, `external_id = company.id` — see `billing-customer.ts`'s
 * own header). NOT via `@polar-sh/better-auth`'s own `portal()` plugin route (removed along with the
 * rest of `polar-plugin.ts`), because that route was unconditionally broken for THIS product even
 * before the per-company move: read directly (`node_modules/@polar-sh/better-auth/dist/index.cjs`'s
 * `portal` endpoint), it always calls
 * `polar2.customerSessions.create({ externalCustomerId: session.user.id, returnUrl })` — no `memberId`,
 * no way to configure one, hard-coded to the SESSION USER besides. Polar rejects a `memberId`-less call
 * with `"member_id is required for team customers"` for a TEAM customer. This product's hosted plan IS
 * seat-based (`POLAR_PRODUCT_ID_MONTHLY`/`YEARLY` are `amountType: "seat_based"` prices, confirmed by
 * reading the live sandbox products 2026-09-15) — and Polar's own model requires a customer that
 * checks out against a seat-based price to be a TEAM customer (so seats can be assigned to individual
 * members), regardless of what `type` the customer row started as. Confirmed live in sandbox: a paying
 * company's Polar customer reads back `type: "team"` with exactly one Polar-auto-created `role: "owner"`
 * member.
 *
 * Multi-user follow-up (same product decision, same day): the portal session is opened for the Polar
 * MEMBER matching the CLICKING user — never unconditionally the owner member — via
 * `member-resolution.ts#resolveOrCreateMemberIdForUser` (creates one, keyed by this user's own id, if
 * neither an app-created nor a Polar-auto-created member matches them yet). Reachable only for
 * OWNER/ADMIN in the first place (`@Roles` on `billing.controller.ts`'s own `POST /billing/portal`) —
 * a plain MEMBER never calls this at all.
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
  MemberResolutionClient,
  ResolvedMemberUser,
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
 * `companyId` is what `checkout-session.ts`'s own `getOrCreatePolarCustomerForCompany` already stamps
 * as the Polar customer's `externalId` (option A, `billing-customer.ts`'s own header). `user` is the
 * CLICKING user (id/email/name) — see this file's own header on why the session is opened for THEM,
 * not the auto-created owner. `returnUrl` mirrors `portal-return-url.ts`'s `FALLBACK_RETURN_URL()` —
 * passed in rather than re-read from `process.env` here so this function stays a pure client call,
 * easy to unit test without env plumbing.
 */
export async function createCustomerPortalSession(
  companyId: string,
  user: ResolvedMemberUser,
  returnUrl: string,
  client: PortalSessionClient = getPolarClient() as unknown as PortalSessionClient,
): Promise<PortalSessionResult> {
  let customer: { id: string; type: string };
  try {
    customer = await client.customers.getExternal({ externalId: companyId });
  } catch (error) {
    if (isResourceNotFoundError(error)) throw new PolarCustomerNotFoundError(companyId);
    throw error;
  }

  const session =
    customer.type === 'team'
      ? await client.customerSessions.create({
          customerId: customer.id,
          memberId: await resolveOrCreateMemberIdForUser(client, customer.id, companyId, user),
          returnUrl,
        })
      : await client.customerSessions.create({ externalCustomerId: companyId, returnUrl });

  return { url: session.customerPortalUrl, redirect: true };
}

/**
 * Same call as `createCustomerPortalSession` above, just keyed by the CLICKING user's own id instead of
 * the company's — opens a portal session for the pre-2026-09-16 per-USER Polar customer a
 * `legacySubscription: true` company's OWNER/ADMIN needs to cancel by hand (there is no Polar API to
 * migrate a subscription onto the new company-scoped customer — see `legacy-customer.ts`'s own header).
 * Reuses `createCustomerPortalSession` wholesale rather than duplicating the team/individual/member
 * dance: that function's own `companyId` parameter is really just "the customer's own external id"
 * throughout its implementation (and `member-resolution.ts`'s, which it calls into) — nothing in either
 * actually assumes it names a `Company` row, so passing the user's own id works unchanged. Throws the
 * SAME `PolarCustomerNotFoundError` (keyed by `user.id` this time) when no Polar customer is registered
 * at all under this user's id — `billing.controller.ts`'s own `POST /billing/portal/legacy` turns that
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
  return createCustomerPortalSession(user.id, user, returnUrl, client);
}
