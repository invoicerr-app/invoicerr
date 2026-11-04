/**
 * The one place a client's primary contact and its four legacy flat fields are derived, so readers
 * that predate the contacts relation keep working through `withDerivedContactFields`.
 */

/** The shape a contact read needs, whichever Prisma `select`/`include` produced it. */
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

/** Primary contact, falling back to the first row if none is flagged (the write path promotes one). */
export function findPrimaryContact<T extends ContactLike>(
  contacts: readonly T[] | null | undefined,
): T | null {
  if (!contacts || contacts.length === 0) return null;
  return contacts.find((c) => c.isPrimary) ?? contacts[0];
}

/** The legacy flat fields from the primary contact; null across the board when there is none. */
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

/** Adds the derived flat fields to a client row that already carries its `contacts` relation. */
export function withDerivedContactFields<T extends { contacts?: readonly ContactLike[] | null }>(
  client: T,
): T & DerivedPrimaryContactFields {
  return { ...client, ...derivePrimaryContactFields(client.contacts) };
}

/** Primary first, then by position: the order the API and the contacts list expect. */
export function orderContactsPrimaryFirst<T extends ContactLike>(contacts: readonly T[]): T[] {
  return [...contacts].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}
