/**
 * Adapts a `Company` row and a `Client` row — two DIFFERENT Prisma shapes, neither named
 * "party" anywhere in the schema — into the ONE `DocumentFormatParty` shape every format provider
 * consumes (`semantic/build-semantic-invoice.ts`'s own `SemanticPartyInput`). This is the ONE place
 * that mapping happens, so a provider never has to know whether it is looking at a seller (always a
 * `Company`) or a buyer (always a `Client`).
 */
import { ContactLike, derivePrimaryContactFields } from '@/modules/clients/primary-contact';

import { DocumentFormatParty } from './format-provider';

export interface CompanyRowForFormat {
  name: string;
  address: string;
  addressLine2?: string | null;
  city: string;
  postalCode: string;
  country: string;
  email?: string | null;
  phone?: string | null;
  /** BT-84 — see Company.iban's own schema comment. Absent for a Client on purpose: a BUYER's own
   *  receiving account has no business term in this bridge today (only the seller ever gets paid on
   *  an invoice), so `clientToFormatParty` below never reads an equivalent column. */
  iban?: string | null;
  partyIdentifiers: { scheme: string; value: string }[];
}

export interface ClientRowForFormat {
  name: string;
  // Contact fields moved off `Client` onto its `contacts` relation (#415) - every caller passes the
  // relation straight through (an `include: { contacts: true }` query, no particular order required:
  // `derivePrimaryContactFields` finds the primary regardless), never the old flat columns.
  contacts: ContactLike[];
  address: string;
  addressLine2?: string | null;
  city: string;
  postalCode: string;
  country: string;
  partyIdentifiers: { scheme: string; value: string }[];
}

export function companyToFormatParty(company: CompanyRowForFormat): DocumentFormatParty {
  return {
    name: company.name,
    address: company.address,
    addressLine2: company.addressLine2,
    city: company.city,
    postalCode: company.postalCode,
    country: company.country,
    email: company.email,
    phone: company.phone,
    iban: company.iban,
    partyIdentifiers: company.partyIdentifiers,
  };
}

export function clientToFormatParty(client: ClientRowForFormat): DocumentFormatParty {
  const primary = derivePrimaryContactFields(client.contacts);
  return {
    // A CLIENT's `name` is required on the schema but a form can still leave it blank for an
    // INDIVIDUAL client that only carries contact first/last names — the same fallback
    // `invoice-rendering.service.ts` used at the reference, reprised here rather than reinvented.
    name:
      client.name || [primary.contactFirstname, primary.contactLastname].filter(Boolean).join(' ') || 'N/A',
    address: client.address,
    addressLine2: client.addressLine2,
    city: client.city,
    postalCode: client.postalCode,
    country: client.country,
    email: primary.contactEmail,
    phone: primary.contactPhone,
    partyIdentifiers: client.partyIdentifiers,
  };
}
