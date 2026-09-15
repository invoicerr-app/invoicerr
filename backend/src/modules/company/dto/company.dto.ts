export interface IdentifierEntry {
  scheme: string;
  value: string;
}

export class EditCompanyDto {
  description?: string;
  foundedAt?: Date;
  name: string;
  currency: import('../../../../prisma/generated/prisma/client').Currency;
  exemptVat?: boolean;
  address?: string;
  addressLine2?: string;
  postalCode?: string;
  city?: string;
  state?: string;
  country: string;
  countryCode?: string;
  // TODO_FEATURES.md rank 14 ("langue du document par destinataire") — the FALLBACK for a client with
  // no `Client.language` of its own; see Company.language's own schema.prisma comment and
  // documents/rendering/language/resolve-recipient-language.ts for the resolution order. Free-text,
  // never validated here — same reasoning as `EditClientsDto.language`.
  language?: string | null;
  phone?: string;
  email?: string;
  /** BT-84 (Payment account identifier) — see Company.iban's own schema.prisma comment. Null/absent
   *  clears it; never validated/fabricated here, the vendored XRechnung Schematron is the real gate. */
  iban?: string | null;
  // The six `quote/invoice/paymentStartingNumber`/`*NumberFormat` fields that used to live here are
  // gone: they belonged to a Prisma query extension removed on this branch (see Company.numberFormats'
  // own schema.prisma comment and the `20260913120000_migrate_legacy_number_formats` migration that
  // absorbed their last values), and nothing has read them since. A document type's number FORMAT is
  // now written through `PUT /api/company/number-format` (`CompanyService#updateNumberFormat`), keyed
  // by the real `DocumentTypeDescriptor` id — never through this DTO's wholesale `...rest` write path,
  // which is also why `company.service.ts#editCompanyInfo` allow-lists its columns explicitly rather
  // than spreading this object: `numberFormats` must only ever be set through the endpoint that
  // validates the pattern. There is no "starting number" capability any more either — see that
  // migration's own header for what a migrating customer loses.
  identifiers?: IdentifierEntry[];
  /** Which registered document transport (documents/transports/transport-registry.ts) the invoice
   *  "send" action uses — e.g. "email". Null/empty clears the choice, which blocks sending until a
   *  new one is chosen; see Company.invoiceTransportId's own comment in schema.prisma. */
  invoiceTransportId?: string | null;
  /** Which registered payment provider (documents/payments/payment-provider-registry.ts) the client
   *  portal's "Pay" link opens a checkout session against. Null/empty falls back to "stripe" — see
   *  Company.paymentProviderId's own comment in schema.prisma for why this one degrades silently
   *  rather than blocking, unlike invoiceTransportId right above. Written by its OWN small selector
   *  on the Payments settings screen (payments.settings.tsx), not the big company-info form — but
   *  through this SAME allow-listed endpoint, the same way invoiceTransportId already is. */
  paymentProviderId?: string | null;
  /** Opts the company INTO multi-currency consolidation — null/absent keeps
   *  every aggregate grouped by currency, unchanged; see Company.referenceCurrency's own comment. */
  referenceCurrency?: string | null;
  /** The approval-threshold gate on "send"; see
   *  Company.approvalThresholdMinor's own schema.prisma comment and documents/approval/approval-gate.ts.
   *  MINOR units. `null` (not `undefined`) is how the settings screen explicitly clears it back to
   *  "no approval required, ever" — `undefined` would be dropped by `...rest` and leave the existing
   *  value untouched, which a blanked-out input must NOT do. */
  approvalThresholdMinor?: number | null;
  /** Gates the daily reminder sweep (`reminders/reminder-sweep-runner.ts`) — see
   *  Company.remindersEnabled's own schema.prisma comment. Off by default; a company left untouched
   *  stays invisible to the sweep. */
  remindersEnabled?: boolean;
}
