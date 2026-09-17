/**
 * Resolves — and, when needed, creates — the Polar TEAM-customer MEMBER that corresponds to ONE
 * Invoicerr user, for ONE company's Polar customer. Shared by `portal-session.ts` (open the portal for
 * the CLICKING user, not systematically the auto-created owner) and `member-sync.ts` (keep Polar
 * members in sync with who holds OWNER/ADMIN) — product decision 2026-09-16's multi-user follow-up.
 *
 * Two ways a member can already exist, and this module has to check BOTH:
 *  1. `externalId = user.id` — a member THIS APP created (`createExternal` below always sets it).
 *  2. No `externalId` at all — Polar's OWN auto-created `role: "owner"` member, minted on the
 *     company's first seat-based checkout using "the customer's email and name" (confirmed live in
 *     sandbox, `portal-session.ts`'s own header) — this app never told Polar which Invoicerr user that
 *     was. Matched here by EMAIL instead. `MemberUpdate` (`@polar-sh/sdk`'s own
 *     `node_modules/@polar-sh/sdk/dist/commonjs/models/components/memberupdate.d.ts`, read directly)
 *     has no `externalId` field — an external id can only be set at CREATE time, never backfilled onto
 *     an existing member — so a match found this way is used by its own Polar-internal `id`, never
 *     "adopted" into the externalId lookup path.
 *
 * The email fallback is safe for a READ (open a portal session for whoever is clicking — some member
 * must be found) but NOT for a DELETE: a company's own billing contact email is very often reused as
 * one of its Invoicerr users' own login email, so `removeMemberForUser` (called the moment that user is
 * demoted off OWNER/ADMIN or removed from the company — `member-sync.ts`) matching by email could
 * delete Polar's own auto-created owner member out from under the company, even though that member was
 * never "this user's own" — it belongs to no Invoicerr user at all. `removeMemberForUser` therefore
 * passes `matchByEmail: false`: a delete acts ONLY on a member this app itself created and can name by
 * its own stored `externalId`, never one merely guessed at by a shared email address.
 */
import { isResourceNotFoundError } from './billing-customer';
import { callPolarWithRetry } from './polar-client';

export interface ResolvedMemberUser {
  /** This app's own user id — becomes the member's `externalId` when THIS module creates one. */
  id: string;
  email: string;
  name?: string | null;
}

/** Narrow, mockable subset of the `Polar` SDK client this module calls — same convention every other
 *  billing file narrows its own client shape to. */
export interface MemberResolutionClient {
  members: {
    listMembers(request: {
      customerId: string;
    }): Promise<
      AsyncIterable<{ result: { items: Array<{ id: string; email: string; externalId: string | null }> } }>
    >;
  };
  customers: {
    members: {
      getExternal(request: { externalId: string; memberExternalId: string }): Promise<{ id: string }>;
      createExternal(request: {
        externalId: string;
        memberCreateFromCustomer: { email: string; name?: string | null; externalId?: string | null };
      }): Promise<{ id: string }>;
      delete(request: { id: string; memberId: string }): Promise<void>;
    };
  };
}

/**
 * Finds this user's own Polar member id for this company's customer — `null` when none exists yet
 * (neither by our own externalId nor, unless `matchByEmail` is `false`, by a Polar-auto-created member
 * sharing this user's email). Never creates one.
 *
 * `matchByEmail` (default `true`, matching every existing read caller) is the ONE way this function is
 * ever unsafe to use as-is: pass `false` before acting on the result with anything DESTRUCTIVE — see
 * this file's own header and `removeMemberForUser`'s own use of it below.
 */
export async function findMemberIdForUser(
  client: MemberResolutionClient,
  customerId: string,
  companyId: string,
  user: ResolvedMemberUser,
  { matchByEmail = true }: { matchByEmail?: boolean } = {},
): Promise<string | null> {
  try {
    const member = await callPolarWithRetry(
      () => client.customers.members.getExternal({ externalId: companyId, memberExternalId: user.id }),
      `members.getExternal for user ${user.id} in company ${companyId}`,
    );
    return member.id;
  } catch (error) {
    if (!isResourceNotFoundError(error)) throw error;
  }

  if (!matchByEmail) return null;

  const pages = await callPolarWithRetry(
    () => client.members.listMembers({ customerId }),
    `members.listMembers for customer ${customerId}`,
  );
  for await (const page of pages) {
    const match = page.result.items.find((item) => item.email === user.email);
    if (match) return match.id;
  }
  return null;
}

/** Same lookup as `findMemberIdForUser`, but creates a fresh member (externalId = user.id) when
 *  nothing matched — used by `portal-session.ts` (the clicking user always needs SOME member to open a
 *  session for) and by `member-sync.ts` (an OWNER/ADMIN must end up WITH a member). */
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
      client.customers.members.createExternal({
        externalId: companyId,
        memberCreateFromCustomer: { email: user.email, name: user.name ?? undefined, externalId: user.id },
      }),
    `members.createExternal for user ${user.id} in company ${companyId}`,
  );
  return created.id;
}

/**
 * Removes this user's member, if one exists — a no-op (never calls `delete`) when none is found.
 * Resolves with `matchByEmail: false` (see `findMemberIdForUser`'s own header): a deletion only ever
 * acts on a member THIS APP created and can name by its own stored `externalId`. A member found only by
 * a shared email — Polar's own auto-created owner member, most often — is left alone; it belongs to no
 * particular Invoicerr user, so no membership CHANGE for one user is ever a reason to delete it.
 */
export async function removeMemberForUser(
  client: MemberResolutionClient,
  customerId: string,
  companyId: string,
  user: ResolvedMemberUser,
): Promise<void> {
  const memberId = await findMemberIdForUser(client, customerId, companyId, user, { matchByEmail: false });
  if (!memberId) return;
  await callPolarWithRetry(
    () => client.customers.members.delete({ id: customerId, memberId }),
    `members.delete for user ${user.id} in company ${companyId}`,
  );
}
