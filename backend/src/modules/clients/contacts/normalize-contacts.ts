/**
 * Drops blank contact rows and resolves the primary. Validation and the write share it, so they
 * cannot disagree about which row is primary.
 */
import { ClientContactDto } from '../dto/clients.dto';

/** A row with nothing typed into it; whitespace counts as empty. */
export function isBlankContact(c: ClientContactDto): boolean {
  return [c.firstName, c.lastName, c.role, c.email, c.phone].every((v) => !v || v.trim() === '');
}

export interface NormalizedContacts<T extends ClientContactDto> {
  /** The surviving rows, blank ones dropped, in their original relative order. */
  contacts: T[];
  /** Whichever surviving row is primary - `null` when none survive at all. */
  primary: T | null;
}

export function normalizeClientContacts<T extends ClientContactDto>(
  rawContacts: readonly T[] | null | undefined,
): NormalizedContacts<T> {
  const contacts = (rawContacts ?? []).filter((c) => !isBlankContact(c));
  if (contacts.length === 0) return { contacts, primary: null };
  const firstFlagged = contacts.findIndex((c) => c.isPrimary);
  const primary = firstFlagged >= 0 ? contacts[firstFlagged] : contacts[0];
  return { contacts, primary };
}
