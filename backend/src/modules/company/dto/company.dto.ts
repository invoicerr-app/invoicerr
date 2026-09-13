export interface PDFConfigDto {
  fontFamily: string;
  includeLogo: boolean;
  logoB64: string | null;
  padding: number;
  primaryColor: string;
  secondaryColor: string;
  labels: {
    // Generic labels
    payment: string;
    billTo: string;
    receivedFrom: string;
    invoiceRefer: string;
    paymentDate: string;
    totalReceived: string;

    // Common fields
    description: string;
    dueDate: string;
    date: string;
    grandTotal: string;
    invoice: string;
    quantity: string;
    quote: string;
    quoteFor: string;
    subtotal: string;
    discount: string;
    total: string;
    unitPrice: string;
    validUntil: string;
    vat: string;
    vatRate: string;
    notes: string;
    paymentMethod: string;
    paymentDetails: string;

    type: string;
    hour: string;
    day: string;
    deposit: string;
    service: string;
    product: string;

    // Payment method labels (for mapping enum types to display text)
    paymentMethodBankTransfer: string;
    paymentMethodPayPal: string;
    paymentMethodCash: string;
    paymentMethodCheck: string;
    paymentMethodOther: string;

    // Legal fields
    legalId: string;
    VATId: string;
  };
}

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
  phone?: string;
  email?: string;
  /** BT-84 (Payment account identifier) — see Company.iban's own schema.prisma comment. Null/absent
   *  clears it; never validated/fabricated here, the vendored XRechnung Schematron is the real gate. */
  iban?: string | null;
  pdfConfig: PDFConfigDto;
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
