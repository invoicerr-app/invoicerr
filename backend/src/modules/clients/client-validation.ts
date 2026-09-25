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

import { IdentifierEntry } from '@/modules/clients/dto/clients.dto';
import { assertClientCustomFieldValuesValid } from '../documents/company-custom-fields/persistence';
import { assertIdentifierValueMatchesPattern } from '../documents/country-identifiers/validate-identifier-value';

export interface ClientCreatableCheckInput {
  type?: string;
  name?: string;
  contactFirstname?: string;
  contactLastname?: string;
  customFields?: Record<string, unknown>;
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
    if (!data.contactFirstname || data.contactFirstname.trim() === '') {
      throw new BadRequestException('First name is required for individual clients');
    }
    if (!data.contactLastname || data.contactLastname.trim() === '') {
      throw new BadRequestException('Last name is required for individual clients');
    }
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
