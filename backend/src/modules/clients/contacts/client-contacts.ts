/**
 * Writes a client's contacts in one place, enforcing "zero, or exactly one primary". `contacts` is
 * authoritative when present; the legacy flat fields merge into the primary; neither is a no-op.
 * `SELECT ... FOR UPDATE` serializes concurrent saves (last writer wins) instead of racing the
 * partial unique index.
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

  // Serializes concurrent writers; without it two saves race the partial unique index.
  await tx.$queryRaw`SELECT "id" FROM "Client" WHERE "id" = ${clientId} FOR UPDATE`;

  if (contacts !== undefined) {
    // Full-snapshot replacement; rows are created one at a time so two primaries never coexist.
    await tx.clientContact.deleteMany({ where: { clientId } });

    // Drop blank rows and resolve the primary exactly as validation does.
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
    // An absent key leaves the column untouched; a present key, even "", overwrites.
    const merged = await tx.clientContact.update({
      where: { id: existingPrimary.id },
      data: {
        firstName: 'contactFirstname' in rawPayload ? blankToNull(legacy.contactFirstname) : undefined,
        lastName: 'contactLastname' in rawPayload ? blankToNull(legacy.contactLastname) : undefined,
        email: 'contactEmail' in rawPayload ? blankToNull(legacy.contactEmail) : undefined,
        phone: 'contactPhone' in rawPayload ? blankToNull(legacy.contactPhone) : undefined,
      },
    });

    // The merge emptied the primary: delete it, then promote the next row.
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

  // Skip an all-blank legacy payload rather than storing an empty contact.
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
