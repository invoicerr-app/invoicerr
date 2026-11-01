import { ClientKind, ClientType, Currency } from '../../../../prisma/generated/prisma/client';

export interface IdentifierEntry {
  scheme: string;
  value: string;
}

/** One entry of `EditClientsDto.contacts`. `id` is accepted but ignored on write, so a GET response
 *  can round-trip into an edit form without being stripped first. */
export interface ClientContactDto {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

/** Query params for `GET /clients/duplicates`; at least `email` or `name` + `country` is required. */
export interface FindDuplicatesQuery {
  email?: string;
  name?: string;
  country?: string;
  /** The client currently being edited, so it never flags itself. */
  excludeId?: string;
}

/** One `matchedOn` reason per row: both rules can trip at once. */
export type DuplicateMatchReason = 'email' | 'name_country';

export interface ClientDuplicateMatch {
  id: string;
  name: string;
  contactEmail: string | null;
  country: string;
  matchedOn: DuplicateMatchReason[];
}

export class EditClientsDto {
  description?: string;
  foundedAt?: Date;
  id: string;
  name: string;
  // Legacy shape: used as the primary contact only when `contacts` is absent.
  contactFirstname?: string;
  contactLastname?: string;
  contactEmail?: string;
  contactPhone?: string;
  // Full ordered replacement of the client's contacts. Absent preserves the flat fields; `[]` means
  // the client now has zero contacts.
  contacts?: ClientContactDto[];
  address?: string | null;
  addressLine2?: string;
  postalCode?: string | null;
  city?: string | null;
  state?: string;
  country: string;
  countryCode?: string;
  // Per-recipient document language, resolved by documents/rendering/language/resolve-recipient-language.
  language?: string | null;
  currency: Currency;
  type?: ClientType;
  // Government buyers require a specific channel/format; defaults to BUSINESS at the DB level.
  kind?: ClientKind;
  // Reconciliation role, independent from `kind`; defaults to false. Normally set by supplier matching.
  isSupplier?: boolean;
  isActive: boolean;
  identifiers?: IdentifierEntry[];
  // Company-defined CLIENT custom fields, keyed by their immutable key and validated before any write.
  customFields?: Record<string, unknown>;
}
