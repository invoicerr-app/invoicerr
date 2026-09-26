/**
 * The ONE place a `Client`'s primary contact is derived - see schema.prisma's own
 * `Client.contacts` header for the "exactly one, or zero" invariant this reads back out of. Every
 * reader that used to touch `Client.contactFirstname`/`contactLastname`/`contactEmail`/`contactPhone`
 * directly (mail senders, the MCP tools, the webhook formatters, the format/party bridge, the
 * accounting export's client labels…) now goes through here instead - most of them via
 * `withDerivedContactFields` below, applied once at the point a `Client` row is fetched
 * (`ClientsService.getClientById`/`getClients`/`searchClients`, the import service's post-create
 * fetch), so a caller that only ever read those four flat properties keeps compiling and behaving
 * identically without itself knowing contacts exist.
 */

/** The shape every `ClientContact` read needs, whichever Prisma `select`/`include` produced it. */
export interface ContactLike {
  firstName: string | null;
  lastName: string | null;
  role?: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  position?: number;
}

export interface DerivedPrimaryContactFields {
  contactFirstname: string | null;
  contactLastname: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

/**
 * Picks the primary contact out of a client's `contacts` array. Falls back to the first entry
 * (`position` order, whatever order the caller's own query already returned - see
 * `orderContactsPrimaryFirst` for callers that need a specific one) when NONE is flagged primary:
 * this should not happen by construction (`writeClientContacts` always promotes one the moment a
 * client has >= 1 contact), but a defensive fallback here is cheap and keeps a reader from silently
 * resolving to "no contact at all" for a client that plainly has one.
 */
export function findPrimaryContact<T extends ContactLike>(
  contacts: readonly T[] | null | undefined,
): T | null {
  if (!contacts || contacts.length === 0) return null;
  return contacts.find((c) => c.isPrimary) ?? contacts[0];
}

/** The four legacy flat fields, derived from whichever contact is primary - `null` across the board
 *  for a client with zero contacts, exactly like an untouched legacy client used to read before this
 *  feature existed. */
export function derivePrimaryContactFields(
  contacts: readonly ContactLike[] | null | undefined,
): DerivedPrimaryContactFields {
  const primary = findPrimaryContact(contacts);
  return {
    contactFirstname: primary?.firstName ?? null,
    contactLastname: primary?.lastName ?? null,
    contactEmail: primary?.email ?? null,
    contactPhone: primary?.phone ?? null,
  };
}

/**
 * Attaches the four derived flat fields onto a client row that already carries its `contacts`
 * relation (an `include`d/`select`ed array, however shallow). Every read path in this module spreads
 * its result through this before returning to a caller, so `client.contactEmail` etc. keep working
 * for every reader that never learns about `contacts` at all - the back-compat contract the issue
 * asks for ("Responses include derived read-only flat fields").
 */
export function withDerivedContactFields<T extends { contacts?: readonly ContactLike[] | null }>(
  client: T,
): T & DerivedPrimaryContactFields {
  return { ...client, ...derivePrimaryContactFields(client.contacts) };
}

/** Orders a client's own contacts primary-first, then by `position` - the order both the API
 *  response and the frontend's contacts list expect ("recap shows contacts with the primary
 *  marked" - the primary is always first). */
export function orderContactsPrimaryFirst<T extends ContactLike>(contacts: readonly T[]): T[] {
  return [...contacts].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}
