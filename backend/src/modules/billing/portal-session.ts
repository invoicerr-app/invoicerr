/**
 * Opens a Polar customer-portal session — NOT via `@polar-sh/better-auth`'s own `portal()` plugin
 * route (`GET/POST /api/auth/customer/portal`, still mounted by `polar-plugin.ts` for its other
 * read-only routes), because that route is unconditionally broken for THIS product.
 *
 * Read directly (`node_modules/@polar-sh/better-auth/dist/index.cjs`'s `portal` endpoint): it always
 * calls `polar2.customerSessions.create({ externalCustomerId: session.user.id, returnUrl })` — no
 * `memberId`, no way to configure one, the plugin's `portal({ returnUrl, theme })` options accept
 * neither. Polar rejects that call with `"member_id is required for team customers"` for a TEAM
 * customer. This product's hosted plan IS seat-based (`POLAR_PRODUCT_ID_MONTHLY`/`YEARLY` are
 * `amountType: "seat_based"` prices, confirmed by reading the live sandbox products 2026-09-15) —
 * and Polar's own model requires a customer that checks out against a seat-based price to be a TEAM
 * customer (so seats can be assigned to individual members), regardless of what `type` (or lack of
 * one) `@polar-sh/better-auth`'s `createCustomerOnSignUp` hook sent when the customer row was first
 * created at sign-up. Confirmed live in the same sandbox incident: the paying company owner's Polar
 * customer read back `type: "team"` with exactly one Polar-auto-created `role: "owner"` member — so
 * every team customer this app will ever see already has the member this function needs; there is no
 * separate "invite your team on Polar's side" step for a company that only ever has one paying user.
 *
 * `individual` customers (a company whose Polar customer predates any checkout, or that Polar never
 * promoted) keep working exactly the way the plugin's own route did — same call, no `memberId`.
 */
import { getPolarClient } from './polar-client';

/** Structurally typed subset of the `Polar` SDK client this function actually calls — the same
 *  "narrow, mockable client shape" `seat-sync.spec.ts` already exercises against `getPolarClient()`,
 *  rather than importing the SDK's full generated `Polar` type here. */
export interface PortalSessionClient {
  customers: {
    getExternal(request: { externalId: string }): Promise<{ id: string; type: string }>;
  };
  members: {
    listMembers(request: {
      customerId: string;
    }): Promise<AsyncIterable<{ result: { items: Array<{ id: string; role: string }> } }>>;
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

/** The single member Polar auto-creates (`role: "owner"`) for a fresh team customer — see this
 *  file's own header. Falls back to the first member listed for a team Polar populated differently
 *  (should not happen for this product, which never invites additional named members), and throws
 *  a named error — rather than letting Polar's own less legible rejection surface — for the one case
 *  that truly has nothing to select. */
async function findMemberIdForTeamCustomer(client: PortalSessionClient, customerId: string): Promise<string> {
  const pages = await client.members.listMembers({ customerId });
  for await (const page of pages) {
    const owner = page.result.items.find((member) => member.role === 'owner') ?? page.result.items[0];
    if (owner) return owner.id;
  }
  throw new Error(`Polar team customer ${customerId} has no member to open a portal session for`);
}

/**
 * `userId` is this app's own user id — the same value `createCustomerOnSignUp`/`checkout()` already
 * stamp as the Polar customer's `externalId` (`polar-plugin.ts`'s own header). `returnUrl` mirrors
 * `polar-plugin.ts`'s `FALLBACK_RETURN_URL()` — passed in rather than re-read from `process.env` here
 * so this function stays a pure client call, easy to unit test without env plumbing.
 */
export async function createCustomerPortalSession(
  userId: string,
  returnUrl: string,
  client: PortalSessionClient = getPolarClient() as unknown as PortalSessionClient,
): Promise<PortalSessionResult> {
  const customer = await client.customers.getExternal({ externalId: userId });

  const session =
    customer.type === 'team'
      ? await client.customerSessions.create({
          customerId: customer.id,
          memberId: await findMemberIdForTeamCustomer(client, customer.id),
          returnUrl,
        })
      : await client.customerSessions.create({ externalCustomerId: userId, returnUrl });

  return { url: session.customerPortalUrl, redirect: true };
}
