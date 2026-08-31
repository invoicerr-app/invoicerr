import prisma from '@/prisma/prisma.service';

import { DocumentEmailTemplate } from '../descriptors/types';

/**
 * The one place a document-SEND reads WHICH email template a company overrode — a single JSON column
 * on Company (`documentEmailTemplates`), read the same tenant-scoped way `numberFormats` already is
 * (numbering/take-number.ts) and `invoiceTransportId` already is (transports/company-transport.ts:
 * "Deliberately its own tiny function... rather than inlined into the action handler"). Same reason
 * here: this is the ONE line that would need to change if the override ever moved to a richer shape.
 *
 * ## Why a NEW column, not the pre-existing `MailTemplate` table
 *
 * `Company.emailTemplates` (the `MailTemplate` model, schema.prisma) already exists — a survivor of
 * the module this branch's document model replaced (see modules/company/company.service.ts's
 * `getEmailTemplates`/`updateEmailTemplate`, and its own settings screen,
 * `settings/_components/templates.settings.tsx`). It was deliberately NOT reused here:
 *
 *  - It is keyed by `MailTemplateType`, a CLOSED Prisma enum (SIGNATURE_REQUEST, VERIFICATION_CODE,
 *    INVOICE, PAYMENT, RECEIPT) fixed by a migration, not by `DocumentTypeRegistry.list()` — the
 *    exact opposite of "a document type is data" this whole module is built on. There is no `QUOTE`
 *    entry at all, and neither `credit-note` nor `expense` has any plausible match among the four
 *    that exist — a THIRD-PARTY document type could never get a column here without a schema
 *    migration, defeating the whole point of a pluggable type registry.
 *  - Its interpolation vocabulary (`{{SIGNATURE_NUMBER}}`, `{{OTP_CODE}}`, `{{INVOICE_NUMBER}}`,
 *    `{{CLIENT_NAME}}`, double-brace) is a DIFFERENT mechanism than this file's `{displayNumber}`/
 *    `{typeLabel}`/`{companyName}`/`{totalGross}`/`{recipientName}` (see email-template.ts) — merging
 *    them would mean rewriting a table three OTHER features (document signature requests, auth OTP
 *    emails) still read/write today.
 *  - Nothing in the actual SEND path (generic-actions.ts, transports/email-transport.ts) reads it —
 *    only `company.service.ts`'s settings-screen CRUD does. Wiring THIS feature onto it would be
 *    resurrecting a dead code path's schema while still not touching the two features that already
 *    depend on its existing rows.
 *
 * `Company.documentEmailTemplates` (schema.prisma) is a plain `Json?`, keyed by
 * `DocumentTypeDescriptor.id` (a string, exactly like `numberFormats`) — open the same way the type
 * registry itself is open, no migration needed for a new type to gain an override.
 *
 * Returns `{}` (never null/undefined) for a company that never set one — a normal, expected state,
 * matching `resolveEmailTemplate`'s own "no override" branch (email-template.ts).
 */
export async function getCompanyDocumentEmailTemplates(
  companyId: string,
): Promise<Record<string, DocumentEmailTemplate>> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { documentEmailTemplates: true },
  });
  const templates = company?.documentEmailTemplates;
  return (templates && typeof templates === 'object' ? templates : {}) as Record<
    string,
    DocumentEmailTemplate
  >;
}
