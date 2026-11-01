/**
 * Pre-create checks shared by `createClient` and the CSV import preview, so both reject a row with
 * the same messages before either writes anything.
 */
import { BadRequestException } from '@nestjs/common';

import { ClientContactDto, IdentifierEntry } from '@/modules/clients/dto/clients.dto';
import { assertClientCustomFieldValuesValid } from '../documents/company-custom-fields/persistence';
import { assertIdentifierValueMatchesPattern } from '../documents/country-identifiers/validate-identifier-value';
import { normalizeClientContacts } from './contacts/normalize-contacts';

export interface ClientCreatableCheckInput {
  type?: string;
  name?: string;
  // The identity is the primary contact's names; the flat fields are the legacy shape.
  contactFirstname?: string;
  contactLastname?: string;
  contacts?: ClientContactDto[];
  customFields?: Record<string, unknown>;
}

/** `contacts`, when present, is authoritative even as `[]`; the flat fields are the fallback. */
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

/** An individual client is the person on the identity step: a different primary would rename it. */
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

/** The individual-identity gate shared by create, edit and the CSV import. */
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

/** The name/type, identifier-pattern and custom-field checks `createClient` always ran. */
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

  // Checked before any row exists, so a rejected import never leaves a half-written client.
  if (identifiers) {
    for (const entry of identifiers) {
      await assertIdentifierValueMatchesPattern({ countryCode, scheme: entry.scheme, value: entry.value });
    }
  }

  await assertClientCustomFieldValuesValid(companyId, data.customFields);
}
