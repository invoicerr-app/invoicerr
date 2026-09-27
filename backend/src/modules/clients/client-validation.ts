/**
 * The pre-create checks `ClientsService.createClient` has always run, extracted so a SECOND caller
 * (the CSV import's preview endpoint, `import/client-import.service.ts`) can apply the exact same
 * checks to a row and show it rejected with the exact same message `createClient` would throw for
 * it later, rather than only discovering the mismatch at confirm time. `createClient` itself calls
 * this now instead of repeating the checks inline - one definition, two callers, so the two paths
 * cannot silently drift the way the form/import schemas could without `client-schema.ts` on the
 * frontend side.
 *
 * Deliberately does not touch Prisma for the CLIENT row itself (no create/update happens here) -
 * only the identifier pattern check reads `PartyIdentifier` (via `assertIdentifierValueMatchesPattern`),
 * for the "unchanged value is never re-validated" grandfather clause, exactly like
 * `upsertPartyIdentifiers` already does for an edit.
 */
import { BadRequestException } from '@nestjs/common';

import { ClientContactDto, IdentifierEntry } from '@/modules/clients/dto/clients.dto';
import { assertClientCustomFieldValuesValid } from '../documents/company-custom-fields/persistence';
import { assertIdentifierValueMatchesPattern } from '../documents/country-identifiers/validate-identifier-value';
import { normalizeClientContacts } from './contacts/normalize-contacts';

export interface ClientCreatableCheckInput {
  type?: string;
  name?: string;
  // Legacy flat fields (checked when `contacts` is absent - see `resolveIdentityContactNames`
  // below) AND the new shape: an INDIVIDUAL client's identity is the PRIMARY contact's first/last
  // name either way, exactly like every other read of "the client's contact" now goes through
  // `contacts` first, flat fields second (#415).
  contactFirstname?: string;
  contactLastname?: string;
  contacts?: ClientContactDto[];
  customFields?: Record<string, unknown>;
}

/** An INDIVIDUAL client's identity step edits the PRIMARY contact's first/last name (design decision
 *  for #415 - see `EditClientsDto.contacts`'s own header). `contacts`, when present, is authoritative
 *  even if it is `[]` (an INDIVIDUAL client that removed its only contact has no name left to check,
 *  which is exactly the error this then throws) - falling back to the flat fields only when the
 *  caller never sent `contacts` at all, the same back-compat rule `writeClientContacts` uses.
 *  Normalized through `normalizeClientContacts` (#415 follow-up review, point 2) - the same function
 *  the actual write runs, so this can never reject a payload the write would have accepted (or the
 *  reverse), and never again find its primary in a different row than the write promotes. */
function resolveIdentityContactNames(data: ClientCreatableCheckInput): {
  firstName?: string | null;
  lastName?: string | null;
} {
  if (data.contacts !== undefined) {
    const { primary } = normalizeClientContacts(data.contacts);
    return { firstName: primary?.firstName, lastName: primary?.lastName };
  }
  return { firstName: data.contactFirstname, lastName: data.contactLastname };
}

/**
 * #415 follow-up review (round 2), point 1: for an INDIVIDUAL client, the client IS the person named
 * on the identity step - `data.contactFirstname`/`contactLastname` are authoritative, and no OTHER
 * `contacts` row may become primary under a different name (that would silently rename the client on
 * every future invoice, with no message anywhere - the bug this check exists to close). Checked only
 * when the caller sent BOTH shapes at once: a `contacts` array with at least one surviving (non-blank)
 * row, AND at least one of the two identity keys on the raw payload (key presence, like
 * `hasLegacyContactField` above - a caller that never touches the identity fields at all has nothing
 * to disagree with itself about, and a legacy flat-field-only payload has no `contacts` array to
 * compare against in the first place, so `resolveIdentityContactNames` already reads straight off it
 * with nothing left for this check to add).
 */
function assertIndividualPrimaryMatchesIdentity(
  data: ClientCreatableCheckInput,
  rawPayload: Record<string, unknown>,
): void {
  if (data.contacts === undefined) return;
  if (!('contactFirstname' in rawPayload) && !('contactLastname' in rawPayload)) return;

  const { primary } = normalizeClientContacts(data.contacts);
  if (!primary) return;

  const identityFirst = (data.contactFirstname ?? '').trim();
  const identityLast = (data.contactLastname ?? '').trim();
  const primaryFirst = (primary.firstName ?? '').trim();
  const primaryLast = (primary.lastName ?? '').trim();

  if (primaryFirst !== identityFirst || primaryLast !== identityLast) {
    throw new BadRequestException(
      'The primary contact of an individual client must be the person on the identity step - ' +
        'edit the identity step instead of flagging a different contact primary',
    );
  }
}

/** The full INDIVIDUAL-identity gate (#415 follow-up review, point 1): the required-name check every
 *  caller already relied on, plus the new "no other row may become primary" check above - kept as one
 *  function so `createClient`/the CSV import (via `assertClientCreatable`) and `editClientsInfo` can
 *  never drift into checking a different rule. `rawPayload` is `data` itself for every call site today
 *  (a plain object literal, never re-typed through a class-validator DTO - see this module's own
 *  header) - kept as a separate parameter rather than assumed so a future caller cannot silently break
 *  the key-presence check by handing in an object that dropped an absent key's own "not present" shape. */
export function assertIndividualIdentity(
  data: ClientCreatableCheckInput,
  rawPayload: Record<string, unknown>,
): void {
  const { firstName, lastName } = resolveIdentityContactNames(data);
  if (!firstName || firstName.trim() === '') {
    throw new BadRequestException('First name is required for individual clients');
  }
  if (!lastName || lastName.trim() === '') {
    throw new BadRequestException('Last name is required for individual clients');
  }
  assertIndividualPrimaryMatchesIdentity(data, rawPayload);
}

/**
 * Throws `BadRequestException` with the SAME messages `createClient` always threw for a name/type
 * mismatch, an identifier failing its country's declared pattern, or an invalid custom field value.
 * `countryCode` is the party's own country (`countryCode ?? country`, matching every existing call
 * site) - needed to resolve which pattern, if any, an identifier's scheme declares for this country.
 */
export async function assertClientCreatable(
  companyId: string,
  data: ClientCreatableCheckInput,
  identifiers: IdentifierEntry[] | undefined,
  countryCode: string | null | undefined,
): Promise<void> {
  const type = data.type || 'COMPANY';

  if (type === 'INDIVIDUAL') {
    assertIndividualIdentity(data, data as unknown as Record<string, unknown>);
  } else {
    if (!data.name || data.name.trim() === '') {
      throw new BadRequestException('Company name is required for company clients');
    }
  }

  // Checked BEFORE the client row itself exists (or, for the import preview, ever will) - see
  // `createClient`'s own former comment on why an orphan/half-written record is worse than refusing
  // outright: this function is called from BOTH that create-time gate and the import preview, which
  // needs the exact same answer without creating anything at all.
  if (identifiers) {
    for (const entry of identifiers) {
      await assertIdentifierValueMatchesPattern({ countryCode, scheme: entry.scheme, value: entry.value });
    }
  }

  await assertClientCustomFieldValuesValid(companyId, data.customFields);
}
