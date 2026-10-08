import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';

import { resolveRequiredIdentifiers } from '../country-identifiers/country-identifiers';

export const CLIENT_INCOMPLETE_CODE = 'CLIENT_INCOMPLETE';

export type MissingClientAddressField = 'address' | 'city';

export interface MissingClientFields {
  address: MissingClientAddressField[];
  identifiers: { scheme: string; label: string }[];
}

export interface ClientIncompleteParams {
  clientId: string;
  clientName: string;
  address: MissingClientAddressField[];
  identifiers: { scheme: string; label: string }[];
}

interface ClientForReadiness {
  address: string | null;
  city: string | null;
  partyIdentifiers: { scheme: string; value: string }[];
}

interface RequiredIdentifier {
  scheme: string;
  label: string;
}

const isBlank = (value: string | null | undefined): boolean => !value || value.trim() === '';

export function findMissingClientFields(
  client: ClientForReadiness,
  requiredIdentifiers: RequiredIdentifier[],
): MissingClientFields {
  const address: MissingClientAddressField[] = [];
  if (isBlank(client.address)) address.push('address');
  if (isBlank(client.city)) address.push('city');

  const identifiers = requiredIdentifiers.filter((required) => {
    const entry = client.partyIdentifiers.find((identifier) => identifier.scheme === required.scheme);
    return isBlank(entry?.value);
  });
  return { address, identifiers };
}

function describeMissing(clientName: string, missing: MissingClientFields): string {
  const names = [...missing.address, ...missing.identifiers.map((identifier) => identifier.label)];
  return `Client "${clientName}" is incomplete. Missing: ${names.join(', ')}. Complete the client before issuing an invoice.`;
}

/**
 * Refuses to number an invoice for a client that lacks what an issued invoice legally needs: a postal
 * address and city, and every identifier the country catalog marks required for the client's country
 * and party type. Drafts and quotes never reach this.
 */
export async function assertClientReadyForInvoice(
  companyId: string,
  clientId: string | undefined,
): Promise<void> {
  if (!clientId) return;
  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: {
      id: true,
      name: true,
      type: true,
      address: true,
      city: true,
      country: true,
      countryCode: true,
      contacts: { where: { isPrimary: true }, select: { firstName: true, lastName: true }, take: 1 },
      partyIdentifiers: { select: { scheme: true, value: true } },
    },
  });
  if (!client) return;

  const countryCode = client.countryCode || guessCountryCode(client.country ?? undefined);
  const { requirements } = await resolveRequiredIdentifiers(countryCode, client.type);
  const required = requirements.filter((requirement) => requirement.required);

  const missing = findMissingClientFields(client, required);
  if (missing.address.length === 0 && missing.identifiers.length === 0) return;

  const primary = client.contacts[0];
  const clientName =
    client.name || [primary?.firstName, primary?.lastName].filter(Boolean).join(' ') || client.id;
  const params: ClientIncompleteParams = {
    clientId: client.id,
    clientName,
    address: missing.address,
    identifiers: missing.identifiers,
  };
  throw new BadRequestException({
    message: describeMissing(clientName, missing),
    code: CLIENT_INCOMPLETE_CODE,
    params,
  });
}
