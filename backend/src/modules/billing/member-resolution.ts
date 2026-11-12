/**
 * A member may already exist either with `externalId = user.id` (created by this app) or with no
 * `externalId` at all (Polar's auto-created owner, matched by email). Polar cannot backfill an
 * `externalId` onto an existing member, so email matches are used by Polar id only.
 *
 * Email matching is safe for reads but not deletes: the billing email is often also a user's login
 * email, so a delete by email could remove Polar's own owner member.
 */
import { isResourceNotFoundError, MissingBillingEmailError } from './billing-customer';
import { callPolarWithRetry } from './polar-client';

export interface ResolvedMemberUser {
  /** Becomes the member's `externalId` when this module creates one. */
  id: string;
  email: string;
  name?: string | null;
}

/** Narrow, mockable subset of the Polar SDK client. Create bodies use the wire's snake_case. */
export interface MemberResolutionClient {
  customers: {
    members: {
      iterList(
        customerId: string,
        query: Record<string, never>,
      ): AsyncGenerator<{ id: string; email: string; external_id: string | null }>;
      getExternal(externalId: string, memberExternalId: string): Promise<{ id: string }>;
      createExternal(
        externalId: string,
        body: {
          email: string;
          name?: string | null;
          external_id?: string | null;
          /** Polar defaults to `"member"`; `"owner"` can only be assigned by transfer, never at creation. */
          role?: 'member' | 'billing_manager';
        },
      ): Promise<{ id: string }>;
      delete(customerId: string, memberId: string): Promise<void>;
    };
  };
}

/** Never creates. Pass `matchByEmail: false` before doing anything destructive with the result. */
export async function findMemberIdForUser(
  client: MemberResolutionClient,
  customerId: string,
  companyId: string,
  user: ResolvedMemberUser,
  { matchByEmail = true }: { matchByEmail?: boolean } = {},
): Promise<string | null> {
  try {
    const member = await callPolarWithRetry(
      () => client.customers.members.getExternal(companyId, user.id),
      `members.getExternal for user ${user.id} in company ${companyId}`,
    );
    return member.id;
  } catch (error) {
    if (!isResourceNotFoundError(error)) throw error;
  }

  if (!matchByEmail) return null;

  // Not wrapped in `callPolarWithRetry`: `iterList` returns its generator synchronously, so there is no
  // single promise to retry; page fetches happen during iteration.
  for await (const member of client.customers.members.iterList(customerId, {})) {
    if (member.email === user.email) return member.id;
  }
  return null;
}

export async function resolveOrCreateMemberIdForUser(
  client: MemberResolutionClient,
  customerId: string,
  companyId: string,
  user: ResolvedMemberUser,
): Promise<string> {
  const existing = await findMemberIdForUser(client, customerId, companyId, user);
  if (existing) return existing;

  const created = await callPolarWithRetry(
    () =>
      client.customers.members.createExternal(companyId, {
        email: user.email,
        name: user.name ?? undefined,
        external_id: user.id,
      }),
    `members.createExternal for user ${user.id} in company ${companyId}`,
  );
  return created.id;
}

/** Cannot collide with a real user id (CUIDs), so only the company billing member ever matches it. */
export const COMPANY_BILLING_MEMBER_EXTERNAL_ID = '__company_billing__';

export interface CompanyBillingMemberIdentity {
  email: string;
  name: string;
}

/**
 * The portal opens against this company-level member, not the clicking user's, otherwise the portal
 * shows that user's email instead of the company's billing email.
 *
 * Usually finds Polar's auto-created owner by email. When it must create one, it uses
 * `billing_manager`: the weakest role that can manage seats and the subscription.
 */
export async function resolveOrCreateCompanyBillingMemberId(
  client: MemberResolutionClient,
  customerId: string,
  companyId: string,
  billing: CompanyBillingMemberIdentity,
): Promise<string> {
  const identity = { id: COMPANY_BILLING_MEMBER_EXTERNAL_ID, email: billing.email, name: billing.name };
  const existing = await findMemberIdForUser(client, customerId, companyId, identity);
  if (existing) return existing;

  // Reachable when both emails were blanked after the customer was promoted to `team`.
  if (!billing.email) throw new MissingBillingEmailError();

  const created = await callPolarWithRetry(
    () =>
      client.customers.members.createExternal(companyId, {
        email: billing.email,
        name: billing.name,
        external_id: COMPANY_BILLING_MEMBER_EXTERNAL_ID,
        role: 'billing_manager',
      }),
    `members.createExternal (company billing member) for company ${companyId}`,
  );
  return created.id;
}

/** Only deletes a member this app created (`matchByEmail: false`), never Polar's auto-created owner. */
export async function removeMemberForUser(
  client: MemberResolutionClient,
  customerId: string,
  companyId: string,
  user: ResolvedMemberUser,
): Promise<void> {
  const memberId = await findMemberIdForUser(client, customerId, companyId, user, { matchByEmail: false });
  if (!memberId) return;
  await callPolarWithRetry(
    () => client.customers.members.delete(customerId, memberId),
    `members.delete for user ${user.id} in company ${companyId}`,
  );
}
