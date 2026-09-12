import { Prisma } from '../../../../prisma/generated/prisma/client';

import { sanitizeEmailHtml } from '@/mail/sanitize-email-html';
import prisma from '@/prisma/prisma.service';

import { DocumentEmailTemplate } from '../descriptors/types';

/**
 * The one place a document-SEND reads, and a settings write writes, WHICH email template a company
 * overrode — a single JSON column on Company (`documentEmailTemplates`), handled the same tenant-scoped
 * way `numberFormats` already is (numbering/take-number.ts) and `invoiceTransportId` already is
 * (transports/company-transport.ts: "Deliberately its own tiny function... rather than inlined into the
 * action handler"). Same reason here: these are the only lines that would need to change if the
 * override ever moved to a richer shape.
 *
 * ## Why this column, not the pre-existing `MailTemplate` table
 *
 * `Company.emailTemplates` (the `MailTemplate` model, schema.prisma) predates this column and still
 * exists, now carrying exactly two families — the signature request and the verification code
 * (`mail/system-email-templates.ts`). It was not reused for DOCUMENT types, and still is not, because it
 * is keyed by `MailTemplateType`, a CLOSED Prisma enum fixed by a migration, not by
 * `DocumentTypeRegistry.list()` — the exact opposite of the "a document type is data" rule this module
 * is built on. There is no `QUOTE` member, nothing a credit note or an expense maps onto, and a
 * THIRD-PARTY document type could never gain a template without a schema migration, defeating the
 * point of a pluggable type registry. This column is a plain `Json?` keyed by
 * `DocumentTypeDescriptor.id` (a string, exactly like `numberFormats`), so a new type gains an override
 * with no migration at all.
 *
 * What is NO LONGER a difference between the two — and what used to be the bulk of the argument here —
 * is the mechanism. Both sides now interpolate the same single-brace `{placeholder}` vocabulary through
 * the same engine (actions/email-template.ts), with the same "an unknown placeholder is left as written
 * and warned about, never thrown" contract, the same optional html part alongside a text one, and the
 * same "company override, else shipped default" precedence. Two storage shapes, for the two genuinely
 * different keying problems above; one engine, one template shape, one set of semantics.
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

/**
 * Stores ONE document type's override, leaving every other type's untouched.
 *
 * Read-modify-write inside a `$transaction`, not a blind overwrite of the whole column: two types being
 * saved at once (two tabs, or a scripted client) must not cost one of them its template. The
 * transaction is what makes the read and the write one step — the same discipline every other
 * multi-write in this module follows.
 *
 * THE html SANITIZATION CHOKEPOINT: every html part reaching the database passes through
 * `sanitizeEmailHtml` (mail/sanitize-email-html.ts) HERE, so no caller — today's settings write, a
 * future import, a plugin — can store markup that was never filtered. Sanitizing at the one write
 * function rather than in the service above it is deliberate: a second writer would otherwise have to
 * remember to do it, and forgetting is silent.
 *
 * An html part that is blank (or becomes blank once sanitized — markup that was nothing but a script
 * tag) is dropped entirely rather than stored as `''`, so the stored shape of a text-only template stays
 * exactly the `{ subject, body }` it has always been.
 */
export async function setCompanyDocumentEmailTemplate(
  companyId: string,
  typeId: string,
  template: DocumentEmailTemplate,
): Promise<DocumentEmailTemplate> {
  const sanitizedHtml = template.html ? sanitizeEmailHtml(template.html) : '';
  const stored: DocumentEmailTemplate = {
    subject: template.subject,
    body: template.body,
    ...(sanitizedHtml.trim() ? { html: sanitizedHtml } : {}),
  };

  await prisma.$transaction(async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { documentEmailTemplates: true },
    });
    const current = company?.documentEmailTemplates;
    const templates = (current && typeof current === 'object' ? current : {}) as Record<
      string,
      DocumentEmailTemplate
    >;

    await tx.company.update({
      where: { id: companyId },
      data: {
        // `as unknown as Prisma.InputJsonValue`: an optional `html?: string` property is not assignable
        // to Prisma's own JSON input type (which admits no `undefined`), the same cast
        // `archive/persistence.ts` already makes for its own structured JSON column.
        documentEmailTemplates: { ...templates, [typeId]: stored } as unknown as Prisma.InputJsonValue,
      },
    });
  });

  return stored;
}

/** Removes ONE type's override, so that type falls back to its descriptor default again (see
 *  `resolveEmailTemplate`). Same read-modify-write-in-a-transaction reasoning as the setter above;
 *  removing an override a company never had is a no-op, never an error. */
export async function clearCompanyDocumentEmailTemplate(companyId: string, typeId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: companyId },
      select: { documentEmailTemplates: true },
    });
    const current = company?.documentEmailTemplates;
    const templates = (current && typeof current === 'object' ? current : {}) as Record<
      string,
      DocumentEmailTemplate
    >;
    if (!Object.hasOwn(templates, typeId)) return;

    const { [typeId]: _removed, ...remaining } = templates;
    await tx.company.update({
      where: { id: companyId },
      data: { documentEmailTemplates: remaining as unknown as Prisma.InputJsonValue },
    });
  });
}
