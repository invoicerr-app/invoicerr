import { ClientKind, ClientType, Currency } from '../../../../prisma/generated/prisma/client';

export interface IdentifierEntry {
  scheme: string;
  value: string;
}

export class EditClientsDto {
  description?: string;
  foundedAt?: Date;
  id: string;
  name: string;
  contactFirstname?: string;
  contactLastname?: string;
  contactEmail?: string;
  contactPhone?: string;
  address: string;
  addressLine2?: string;
  postalCode: string;
  city: string;
  state?: string;
  country: string;
  countryCode?: string;
  // Per-recipient document language ("langue du document par destinataire") — see Client.language's
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
  // Custom fields ("champs personnalisés") — one entry per company-defined CLIENT-target
  // `CompanyCustomField`, keyed by that definition's own immutable `key` (never prefixed — see
  // `Client.customFields`'s own schema.prisma header). Validated in `clients.service.ts` against this
  // company's ACTIVE definitions (`company-custom-fields/persistence.ts#assertClientCustomFieldValuesValid`)
  // before either write path persists it; optional, so every existing caller that never sends this
  // field keeps today's behavior exactly (an unchanged `{}`/`null` column).
  customFields?: Record<string, unknown>;
}
