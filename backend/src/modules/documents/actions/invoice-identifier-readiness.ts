import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { companyLawMentions } from '../company-law/company-law';
import {
  MissingInvoiceIdentifier,
  invoiceBuyer,
  invoiceSeller,
  missingInvoiceIdentifiers,
} from '../country-identifiers/printed-identifiers';

export const INVOICE_IDENTIFIERS_MISSING_CODE = 'INVOICE_IDENTIFIERS_MISSING';

export interface InvoiceIdentifiersMissingParams {
  clientId?: string;
  missing: MissingInvoiceIdentifier[];
}

const PARTY_NAMES = { SELLER: 'seller', BUYER: 'buyer' } as const;

const partyIdentifierSelect = {
  countryCode: true,
  country: true,
  partyIdentifiers: { select: { scheme: true, value: true } },
} as const;
export interface InvoiceIdentifierGaps {
  missing: MissingInvoiceIdentifier[];
  clientFound: boolean;
}

/**
 * Every identifier the seller's country requires on an invoice from this company to this client that
 * is still empty, read from that country's `identifiers.invoiceRequirements` with the same conditions
 * the working-copy PDF uses to flag a missing one, followed by the company-law values its
 * `companyLaw` section requires of the seller.
 */
export async function findMissingInvoiceIdentifiers(
  companyId: string,
  clientId: string | undefined,
): Promise<InvoiceIdentifierGaps> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { ...partyIdentifierSelect, exemptVat: true, companyLaw: true },
  });
  if (!company) return { missing: [], clientFound: false };
  const client = clientId
    ? await prisma.client.findFirst({
        where: { id: clientId, companyId },
        select: { ...partyIdentifierSelect, type: true, vatRegistered: true },
      })
    : null;

  const seller = invoiceSeller(company);
  const missing = missingInvoiceIdentifiers(seller, client ? invoiceBuyer(client) : undefined);
  const companyLaw = companyLawMentions({
    countryCode: seller.countryCode,
    documentTypeId: 'invoice',
    language: 'en',
    details: company.companyLaw,
    identifiers: seller.identifiers,
  });
  for (const field of companyLaw.missing) {
    if (!missing.some((entry) => entry.party === 'SELLER' && entry.scheme === field.key)) {
      missing.push({ party: 'SELLER', scheme: field.key, label: field.label });
    }
  }
  return { missing, clientFound: !!client };
}

/** Refuses to number an invoice that lacks an identifier the seller's country requires on it. */
export async function assertInvoiceIdentifiersPresent(
  companyId: string,
  clientId: string | undefined,
): Promise<void> {
  const { missing, clientFound } = await findMissingInvoiceIdentifiers(companyId, clientId);
  if (missing.length === 0) return;

  const names = missing.map((identifier) => `${identifier.label} (${PARTY_NAMES[identifier.party]})`);
  const params: InvoiceIdentifiersMissingParams = { clientId: clientFound ? clientId : undefined, missing };
  throw new BadRequestException({
    message: `This invoice is missing details its seller's country requires: ${names.join(', ')}. Complete them before issuing it.`,
    code: INVOICE_IDENTIFIERS_MISSING_CODE,
    params,
  });
}
