/**
 * The ONE place a raw `contacts` array (as it arrives on the wire, before any DB write) gets
 * normalized: blank rows dropped, then a primary resolved from what remains - whichever surviving
 * row says `isPrimary: true` (the FIRST one to, if a caller sent several), or the first survivor
 * when none does. Both `client-validation.ts` (the pre-create/CSV-import identity check) and
 * `client-contacts.ts#writeClientContacts` (the actual write) call this instead of each doing its
 * own drop-then-find - which is what let them disagree (#415 follow-up review, point 2):
 * validation used to look for the primary in the RAW array (finding a blank row flagged primary and
 * rejecting the whole payload for a missing name), while the write already dropped that same blank
 * row and promoted the next non-blank one - a payload the write would have happily accepted 400'd
 * anyway, before ever reaching it.
 */
import { ClientContactDto } from '../dto/clients.dto';

/** A row with nothing typed into it at all - the same rule the migration's own backfill and the CSV
 *  import already apply (see `writeClientContacts`'s own header). Checked with `.trim()`: pure
 *  whitespace is exactly as "nothing here" as an empty string. Exported because the legacy flat-field
 *  path in `writeClientContacts` applies the SAME rule to the primary row it has just merged into
 *  (#478): one definition of "empty contact", whichever payload shape produced it. */
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
