/**
 * The ONE place a client wizard's raw `contacts` array gets normalized into what will actually be
 * saved: blank rows dropped, then a primary resolved from what remains - whichever surviving row
 * says `isPrimary: true` (the FIRST one to, if several do), or the first survivor when none does.
 *
 * This is a frontend TWIN of `backend/src/modules/clients/contacts/normalize-contacts.ts`, not an
 * import of it - the two projects share no runtime code (see the repo's own CLAUDE.md). Both files
 * must stay byte-for-byte equivalent in behavior; `normalize-client-contacts.spec.ts` pins the two
 * together with the exact same case table the backend spec runs.
 *
 * Before this existed, `client-upsert.tsx#buildClientPayload` picked the primary contact BEFORE
 * dropping empty rows while the backend's `normalizeClientContacts` dropped them FIRST - so a blank
 * default row flagged primary showed as "Primary" in the summary and was what the duplicate check
 * looked at, while the server actually saved a different row (the first non-blank one) as primary
 * (#415 follow-up review, round 3, point 3). Both `buildClientPayload` and the duplicate-email check
 * now call this function instead of each reading the raw array its own way.
 */

/** The subset of a contact row's shape this function needs - matches the backend's
 *  `ClientContactDto` fields it reads, loose enough to fit both the wizard's react-hook-form values
 *  and the duplicate-check's own narrower watch cast. */
export interface ClientContactLike {
  firstName?: string
  lastName?: string
  role?: string
  email?: string
  phone?: string
  isPrimary?: boolean
}

/** A row with nothing typed into it at all - the same rule the backend's `isBlankContact` applies.
 *  Checked with `.trim()`: pure whitespace is exactly as "nothing here" as an empty string. */
function isBlankContact(c: ClientContactLike): boolean {
  return [c.firstName, c.lastName, c.role, c.email, c.phone].every((v) => !v || v.trim() === "")
}

export interface NormalizedContacts<T extends ClientContactLike> {
  /** The surviving rows, blank ones dropped, in their original relative order. */
  contacts: T[]
  /** Whichever surviving row is primary - `null` when none survive at all. */
  primary: T | null
}

export function normalizeClientContacts<T extends ClientContactLike>(
  rawContacts: readonly T[] | null | undefined,
): NormalizedContacts<T> {
  const contacts = (rawContacts ?? []).filter((c) => !isBlankContact(c))
  if (contacts.length === 0) return { contacts, primary: null }
  const firstFlagged = contacts.findIndex((c) => c.isPrimary)
  const primary = firstFlagged >= 0 ? contacts[firstFlagged] : contacts[0]
  return { contacts, primary }
}
