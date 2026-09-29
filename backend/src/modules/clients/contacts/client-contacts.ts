/**
 * Writes a client's `ClientContact` rows inside a transaction, enforcing "zero, or exactly one
 * primary" at the application level (schema.prisma's partial unique index is the DB-level backstop -  * see that model's own header). The ONE place either write path (`createClient`, `editClientsInfo`)
 * touches this relation, so the two can never disagree about the invariant.
 *
 * Two input shapes, matching `EditClientsDto`'s own back-compat contract (see that DTO's own
 * `contacts` field header):
 *  - `contacts` present (even `[]`): AUTHORITATIVE full replacement - every existing contact row for
 *    this client is deleted and recreated from this array, in array order (`position` reassigned
 *    0..n-1). An entry whose firstName, lastName, role, email AND phone are all empty or
 *    whitespace-only is dropped first (#415 follow-up review, point 3) - the same "no row for an
 *    empty contact" rule the migration's own backfill and the CSV import already apply, so the API
 *    behaves the same regardless of caller: a client created with an untouched, never-typed-into
 *    contact row ends up with zero contacts, not a "- / -" primary. Exactly one of what REMAINS
 *    becomes primary: whichever entry says `isPrimary: true` (the FIRST one to, if a caller sent
 *    several - this function chooses, it never throws for a caller's own mistake), or the first
 *    entry when none does - so a dropped entry that happened to be flagged primary simply falls
 *    through to the first surviving one, never leaving a client with contacts and no primary. An
 *    empty array (or an array of only-blank entries) means "this client now has zero contacts",
 *    a valid, intentional state (the issue's own "zero, one or several" wording).
 *  - `contacts` absent, but the raw payload carries at least one of the four legacy flat keys
 *    (`contactFirstname`/`contactLastname`/`contactEmail`/`contactPhone` - checked by KEY PRESENCE,
 *    not truthiness, so `{ contactEmail: "" }` still counts as "this caller is using the old shape"):
 *    an old-shape caller (API key, MCP tool, an external integration that has not adopted `contacts`
 *    yet). Its four fields become (create) or update (merge into) the primary contact; every OTHER
 *    contact already on the client is left untouched. If the merge leaves the primary row empty
 *    (every legacy field sent as `""` and no `role` on the row), that row is DELETED rather than kept
 *    as a "-" contact (#478), the same "an empty contact is never stored" rule the `contacts` path
 *    applies, and the next contact in `position` order, if any, is promoted primary.
 *  - Neither: no-op. A caller that touches neither shape (e.g. an address-only edit through a
 *    `contacts`-aware frontend that simply did not resend contacts) must never wipe them out from
 *    under it.
 *
 * Concurrency (#478): two saves of the same client at the same moment are LAST-WRITER-WINS, not a
 * 409. Every write below starts by taking the parent `Client` row's lock (`SELECT ... FOR UPDATE`),
 * so a second writer waits for the first to commit, then reads the committed rows and replaces them
 * with its own snapshot. Without that lock, both writers' `deleteMany` ran against the same committed
 * rows, both inserted a primary, and the second insert hit the partial unique index
 * `ClientContact_clientId_primary_key`: its whole transaction rolled back (address included) and the
 * caller got a generic 500. Why not a 409: the client form, the contacts list, the address and
 * `customFields` are all already full-snapshot, last-writer-wins writes; `Client` carries no version
 * a caller could send back, so a 409 would give the caller nothing to act on beyond "retry", which is
 * what the lock does for it. `editClientsInfo` happens to update the `Client` row before calling this
 * function, which already takes the same lock; the explicit lock here is what keeps the guarantee
 * when a caller does not (a reordered transaction, a future write path), instead of relying on it.
 */
import { Prisma } from '../../../../prisma/generated/prisma/client';
import { ClientContactDto } from '../dto/clients.dto';
import { isBlankContact, normalizeClientContacts } from './normalize-contacts';

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
  if (contacts === undefined && !hasLegacyContactField(rawPayload)) return;

  // Serializes concurrent writers of the same client's contacts (#478) - see this file's own header.
  await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${clientId} FOR UPDATE`;

  if (contacts !== undefined) {
    // Delete-then-recreate, never a per-row upsert-and-reconcile: the frontend's contacts step is a
    // full snapshot of the list on every save (add/remove/reorder all happen client-side first), the
    // same "a submitted form replaces the stored value wholesale" convention `editClientsInfo`'s own
    // `customFields` write already holds. Rows are created ONE AT A TIME, in order, inside this same
    // transaction - never more than one `isPrimary: true` row exists at once, so the partial unique
    // index is never even momentarily violated.
    await tx.clientContact.deleteMany({ where: { clientId } });

    // Drop an all-blank entry before anything else is decided from this array (#415 follow-up review,
    // point 3), then resolve which surviving row is primary - both through `normalizeClientContacts`
    // (#415 follow-up review, point 2), the same function `client-validation.ts` runs the identity
    // check against, so the two can never again look at a different notion of "the primary contact".
    const { contacts: nonBlankContacts, primary } = normalizeClientContacts(contacts);
    if (nonBlankContacts.length === 0) return;

    for (const [index, entry] of nonBlankContacts.entries()) {
      await tx.clientContact.create({
        data: {
          clientId,
          firstName: blankToNull(entry.firstName),
          lastName: blankToNull(entry.lastName),
          role: blankToNull(entry.role),
          email: blankToNull(entry.email),
          phone: blankToNull(entry.phone),
          isPrimary: entry === primary,
          position: index,
        },
      });
    }
    return;
  }

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
    const merged = await tx.clientContact.update({
      where: { id: existingPrimary.id },
      data: {
        firstName: 'contactFirstname' in rawPayload ? blankToNull(legacy.contactFirstname) : undefined,
        lastName: 'contactLastname' in rawPayload ? blankToNull(legacy.contactLastname) : undefined,
        email: 'contactEmail' in rawPayload ? blankToNull(legacy.contactEmail) : undefined,
        phone: 'contactPhone' in rawPayload ? blankToNull(legacy.contactPhone) : undefined,
      },
    });

    // #478: the merge emptied the primary (a legacy caller clearing "the" contact by sending every
    // field as ""). Judged on the MERGED row, not the payload: a caller that blanks only the phone
    // keeps its contact, and a row that still carries a `role` (a column a legacy caller cannot even
    // see) is not empty either. Delete first, then promote, so two primaries never coexist even
    // inside this transaction.
    if (isBlankContact(merged)) {
      await tx.clientContact.delete({ where: { id: merged.id } });
      const next = await tx.clientContact.findFirst({
        where: { clientId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      if (next) await tx.clientContact.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    return;
  }

  // No primary yet - a brand new client created through the old flat shape, or an existing one that
  // never had a contact. Skip creating an empty row for a caller that sent every field blank (e.g.
  // `{ contactFirstname: "", ... }` on an edit that never touched contacts at all in practice).
  if (
    isBlankContact({
      firstName: legacy.contactFirstname,
      lastName: legacy.contactLastname,
      email: legacy.contactEmail,
      phone: legacy.contactPhone,
    })
  ) {
    return;
  }

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
