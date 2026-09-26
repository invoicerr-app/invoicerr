/**
 * Writes a client's `ClientContact` rows inside a transaction, enforcing "zero, or exactly one
 * primary" at the application level (schema.prisma's partial unique index is the DB-level backstop -  * see that model's own header). The ONE place either write path (`createClient`, `editClientsInfo`)
 * touches this relation, so the two can never disagree about the invariant.
 *
 * Two input shapes, matching `EditClientsDto`'s own back-compat contract (see that DTO's own
 * `contacts` field header):
 *  - `contacts` present (even `[]`): AUTHORITATIVE full replacement - every existing contact row for
 *    this client is deleted and recreated from this array, in array order (`position` reassigned
 *    0..n-1). Exactly one becomes primary: whichever entry says `isPrimary: true` (the FIRST one to,
 *    if a caller sent several - this function chooses, it never throws for a caller's own mistake),
 *    or the first entry when none does. An empty array means "this client now has zero contacts",
 *    a valid, intentional state (the issue's own "zero, one or several" wording).
 *  - `contacts` absent, but the raw payload carries at least one of the four legacy flat keys
 *    (`contactFirstname`/`contactLastname`/`contactEmail`/`contactPhone` - checked by KEY PRESENCE,
 *    not truthiness, so `{ contactEmail: "" }` still counts as "this caller is using the old shape"):
 *    an old-shape caller (API key, MCP tool, an external integration that has not adopted `contacts`
 *    yet). Its four fields become (create) or update (merge into) the primary contact; every OTHER
 *    contact already on the client is left untouched.
 *  - Neither: no-op. A caller that touches neither shape (e.g. an address-only edit through a
 *    `contacts`-aware frontend that simply did not resend contacts) must never wipe them out from
 *    under it.
 */
import { Prisma } from '../../../../prisma/generated/prisma/client';
import { ClientContactDto } from '../dto/clients.dto';

const LEGACY_CONTACT_KEYS = ['contactFirstname', 'contactLastname', 'contactEmail', 'contactPhone'] as const;

function hasLegacyContactField(rawPayload: Record<string, unknown>): boolean {
  return LEGACY_CONTACT_KEYS.some((key) => key in rawPayload);
}

function blankToNull(value: string | null | undefined): string | null {
  return value || null;
}

export async function writeClientContacts(
  tx: Prisma.TransactionClient,
  clientId: string,
  rawPayload: Record<string, unknown>,
  contacts: ClientContactDto[] | undefined,
): Promise<void> {
  if (contacts !== undefined) {
    // Delete-then-recreate, never a per-row upsert-and-reconcile: the frontend's contacts step is a
    // full snapshot of the list on every save (add/remove/reorder all happen client-side first), the
    // same "a submitted form replaces the stored value wholesale" convention `editClientsInfo`'s own
    // `customFields` write already holds. Rows are created ONE AT A TIME, in order, inside this same
    // transaction - never more than one `isPrimary: true` row exists at once, so the partial unique
    // index is never even momentarily violated.
    await tx.clientContact.deleteMany({ where: { clientId } });
    if (contacts.length === 0) return;

    const firstFlagged = contacts.findIndex((c) => c.isPrimary);
    const primaryIndex = firstFlagged >= 0 ? firstFlagged : 0;

    for (const [index, entry] of contacts.entries()) {
      await tx.clientContact.create({
        data: {
          clientId,
          firstName: blankToNull(entry.firstName),
          lastName: blankToNull(entry.lastName),
          role: blankToNull(entry.role),
          email: blankToNull(entry.email),
          phone: blankToNull(entry.phone),
          isPrimary: index === primaryIndex,
          position: index,
        },
      });
    }
    return;
  }

  if (!hasLegacyContactField(rawPayload)) return;

  const legacy = rawPayload as {
    contactFirstname?: string | null;
    contactLastname?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  };

  const existingPrimary = await tx.clientContact.findFirst({ where: { clientId, isPrimary: true } });

  if (existingPrimary) {
    // A legacy caller only ever sends what it knows about (four fields, never `role`) - a KEY it
    // never sends (`undefined`, not present) leaves that column untouched, the exact same "absent
    // key means don't touch it" Prisma convention `editClientsInfo`'s own `customFields` write
    // already relies on. A key it DOES send, even as an empty string, overwrites - that is what
    // "unsetting the phone number" through the old API shape looks like.
    await tx.clientContact.update({
      where: { id: existingPrimary.id },
      data: {
        firstName: 'contactFirstname' in rawPayload ? blankToNull(legacy.contactFirstname) : undefined,
        lastName: 'contactLastname' in rawPayload ? blankToNull(legacy.contactLastname) : undefined,
        email: 'contactEmail' in rawPayload ? blankToNull(legacy.contactEmail) : undefined,
        phone: 'contactPhone' in rawPayload ? blankToNull(legacy.contactPhone) : undefined,
      },
    });
    return;
  }

  // No primary yet - a brand new client created through the old flat shape, or an existing one that
  // never had a contact. Skip creating an empty row for a caller that sent every field blank (e.g.
  // `{ contactFirstname: "", ... }` on an edit that never touched contacts at all in practice).
  const allBlank = LEGACY_CONTACT_KEYS.every((key) => !(legacy as Record<string, unknown>)[key]);
  if (allBlank) return;

  await tx.clientContact.create({
    data: {
      clientId,
      firstName: blankToNull(legacy.contactFirstname),
      lastName: blankToNull(legacy.contactLastname),
      email: blankToNull(legacy.contactEmail),
      phone: blankToNull(legacy.contactPhone),
      isPrimary: true,
      position: 0,
    },
  });
}
