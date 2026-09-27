import { ClientKind, ClientType, Currency } from '../../../../prisma/generated/prisma/client';

export interface IdentifierEntry {
  scheme: string;
  value: string;
}

/** One entry of `EditClientsDto.contacts` - see that field's own header for the full back-compat
 *  contract and `contacts/client-contacts.ts#writeClientContacts` for how an array of these is
 *  written. `id` is accepted but IGNORED on write (a full replace never needs to match an incoming
 *  entry back to an existing row) - present only so a frontend that round-trips a `GET` response
 *  straight into its own edit form does not have to strip it back out first. */
export interface ClientContactDto {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

/** Query params for `GET /clients/duplicates` — see `ClientsService.findDuplicates`'s own header for
 *  the matching rule. All optional on the wire (`ClientsController` reads raw query strings), but the
 *  service returns `[]` unless at least one usable criterion (`email`, or `name` + `country` together)
 *  is present — an unscoped "list every client" is not this endpoint's job. */
export interface FindDuplicatesQuery {
  email?: string;
  name?: string;
  country?: string;
  /** The client currently being EDITED, so its own record never flags itself as its own duplicate —
   *  absent on a create screen, where there is no id yet to exclude. */
  excludeId?: string;
}

/** One `matchedOn` reason per row — a duplicate can trip both criteria at once (rare, but a client
 *  named identically in the same country AND sharing the exact email is not a schema this endpoint
 *  needs to disambiguate further), so this is an array, not a single enum value. */
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
  // Legacy back-compat shape (#415): an old-shape caller (API key, MCP tool, an external integration
  // that has not adopted `contacts` below yet) still sends these four flat fields; when `contacts` is
  // ABSENT, `writeClientContacts` treats them as the primary contact (create or update). A caller
  // sending `contacts` should not also send these - they are simply ignored in that case (`contacts`
  // wins outright, see that function's own header).
  contactFirstname?: string;
  contactLastname?: string;
  contactEmail?: string;
  contactPhone?: string;
  // The new shape (#415) - a full, ordered replacement of this client's contacts. Absent (not `[]`)
  // preserves today's behavior for a caller still using the four flat fields above; `[]` explicitly
  // means "this client now has zero contacts". See `client-contacts.ts#writeClientContacts`'s own
  // header for the full contract, and this module's `primary-contact.ts` for how a response derives
  // the legacy flat fields back out of whichever contact ends up primary.
  contacts?: ClientContactDto[];
  address: string;
  addressLine2?: string;
  postalCode: string;
  city: string;
  state?: string;
  country: string;
  countryCode?: string;
  // Per-recipient document language — see Client.language's
  // own schema.prisma comment for the resolution this feeds
  // (documents/rendering/language/resolve-recipient-language.ts). Free-text, never validated here
  // (this DTO is a TypeScript interface, not runtime-checked — see editClientsInfo's own comment on
  // why every write path allow-lists its columns instead).
  language?: string | null;
  currency: Currency;
  type?: ClientType;
  // B2G routing (documents/b2g-routing/) — GOVERNMENT changes which channel/format an invoice to
  // this client must use, per its own country. Optional, defaults to BUSINESS at the DB level
  // (schema.prisma's own `@default(BUSINESS)`) — every existing caller that never sends this field
  // keeps today's behavior exactly.
  kind?: ClientKind;
  // The received-invoice reconciliation's own "role", a PLAIN, INDEPENDENT
  // boolean (never folded into `kind` above — see schema.prisma's own `Client.isSupplier` comment for
  // the full "why"). Optional, defaults to `false` at the DB level: every existing caller that never
  // sends this field keeps today's behaviour exactly. Normally set by
  // `received-invoices/supplier-reconciliation.ts` (auto-match or a manual link), but also editable
  // by hand here — nothing prevents a company from flagging a supplier before ever receiving an
  // invoice from it.
  isSupplier?: boolean;
  isActive: boolean;
  identifiers?: IdentifierEntry[];
  // Custom fields — one entry per company-defined CLIENT-target
  // `CompanyCustomField`, keyed by that definition's own immutable `key` (never prefixed — see
  // `Client.customFields`'s own schema.prisma header). Validated in `clients.service.ts` against this
  // company's ACTIVE definitions (`company-custom-fields/persistence.ts#assertClientCustomFieldValuesValid`)
  // before either write path persists it; optional, so every existing caller that never sends this
  // field keeps today's behavior exactly (an unchanged `{}`/`null` column).
  customFields?: Record<string, unknown>;
}
