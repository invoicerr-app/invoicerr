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
 */
import { isResourceNotFoundError } from './billing-customer';

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

/** Finds this user's own Polar member id for this company's customer — `null` when none exists yet
 *  (neither by our own externalId nor by a Polar-auto-created member sharing this user's email).
 *  Never creates one. */
export async function findMemberIdForUser(
  client: MemberResolutionClient,
  customerId: string,
  companyId: string,
  user: ResolvedMemberUser,
): Promise<string | null> {
  try {
    const member = await client.customers.members.getExternal({
      externalId: companyId,
      memberExternalId: user.id,
    });
    return member.id;
  } catch (error) {
    if (!isResourceNotFoundError(error)) throw error;
  }

  const pages = await client.members.listMembers({ customerId });
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

  const created = await client.customers.members.createExternal({
    externalId: companyId,
    memberCreateFromCustomer: { email: user.email, name: user.name ?? undefined, externalId: user.id },
  });
  return created.id;
}

/** Removes this user's member, if one exists — a no-op (never calls `delete`) when none is found. */
export async function removeMemberForUser(
  client: MemberResolutionClient,
  customerId: string,
  companyId: string,
  user: ResolvedMemberUser,
): Promise<void> {
  const memberId = await findMemberIdForUser(client, customerId, companyId, user);
  if (!memberId) return;
  await client.customers.members.delete({ id: customerId, memberId });
}
