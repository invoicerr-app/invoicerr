import { MailService } from '@/mail/mail.service';
import { logger } from '@/logger/logger.service';

import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { takeDocumentNumberForTransition } from '../numbering/take-number';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { renderDocumentInstance } from '../rendering/render-instance-pdf';
import { DocumentInstanceResult } from './action-registry';
import { getCompanyDocumentEmailTemplates } from './company-email-templates';
import { buildEmailTemplateParts, renderEmailTemplate, resolveEmailTemplate } from './email-template';

export interface SendDocumentEmailDeps {
  mailService: MailService;
  typeRegistry: DocumentTypeRegistry;
  referenceRegistry: EntityReferenceRegistry;
}

export interface SendDocumentEmailInput {
  companyId: string;
  typeId: string;
  /** The instance, already written to its post-transition status (e.g. "sent") — see this file's own
   *  header for why numbering is pulled forward from HERE rather than left to
   *  documents.service.ts's usual post-handler hook. */
  document: DocumentInstanceResult;
  recipient: string;
  /** Plain data (not an i18n key), the same convention as DocumentTypeDescriptor.label — e.g. "Quote". */
  label: string;
}

export interface SendDocumentEmailResult {
  /** Human-facing outcome string — same convention as ActionResult.message. */
  message: string;
}

/**
 * Sends ONE document instance by email WITH its PDF attached — the shared core behind the quote's
 * own unconditional "send" (generic-actions.ts's `registerEmailSendAction`) and the invoice's "email"
 * transport (transports/email-transport.ts). Neither caller is merged into the other by this: each
 * still decides ON ITS OWN whether/how it is even reachable (the quote always emails; the invoice
 * only gets here if the company chose the "email" transport — see invoice-actions.ts) and, most
 * importantly, WHO the recipient is (`input.recipient` — typed by the user for the quote, resolved
 * from the client's contact email for the invoice). Only the "compose + attach + send" mechanics
 * below are actually shared — see actions/send-divergence.spec.ts for the guardrail proving the two
 * callers still never share an ADDRESSING or transport decision.
 *
 * ## Numbering, pulled forward
 *
 * `documents.service.ts`'s `runAction` normally takes a document's number ONLY AFTER an action
 * handler returns (see its own comment there: it needs to know the handler's ACTUAL status
 * transition first, generically, for every action of every type). The filename and the
 * `{displayNumber}` template placeholder this function builds need the number at SEND time, not
 * after — so when this type is numbered on entering the status `input.document` already carries, and
 * it has not been numbered yet, this function takes the number itself, calling the exact same
 * `takeDocumentNumberForTransition` `runAction` would otherwise call on its own. Safe to do from here
 * too: `takeDocumentNumber` (numbering/sequence.ts) is a DB-level "number IS NULL" guard — once THIS
 * call sets it, `runAction`'s own post-handler check (`result.document.number == null`) is false and
 * it skips its own call entirely. No number is ever taken twice, none is ever wasted.
 *
 * ## PDF failure — fails LOUDLY, never a silent send without the attachment
 *
 * If `renderDocumentInstance` throws (e.g. Puppeteer unavailable), this function does NOT catch it
 * and fall back to sending a bare email: the error propagates straight out, `mailService.sendMail` is
 * NEVER called, and the caller's whole "send" action fails with the render engine's own message. A
 * commercial email promising a document with no document actually attached is a worse failure mode
 * than a delayed one — the same "blocked, and says so" discipline invoice-actions.ts already holds
 * for a missing transport. See actions/send-document-email.spec.ts's "a PDF failure never sends a
 * bare email" coverage — mocking `renderDocumentInstance` itself (the entry point this function calls
 * into), never this function's own internals, so the test cannot pass for the wrong reason.
 *
 * The one known, accepted gap this leaves: `input.document` is handed to this function ALREADY
 * written to its new status (both callers persist it via `upsertDocument` first, unchanged from
 * before this task) — a PDF failure here does not roll that back, so the record can be left "sent"
 * (and, if numbering ran first, numbered) with no message ever delivered. This is not a NEW gap: the
 * exact same order (persist "sent", THEN attempt delivery) already existed before this task for a
 * plain `mailService.sendMail` failure — see this file's own git history. Actually rolling it back
 * would need a transactional or "pending" intermediate status this branch's lifecycle model does not
 * have today; recorded here rather than silently accepted.
 */
export async function sendDocumentInstanceEmail(
  deps: SendDocumentEmailDeps,
  input: SendDocumentEmailInput,
): Promise<SendDocumentEmailResult> {
  const { companyId, typeId, recipient, label } = input;
  let document = input.document;
  const descriptor = deps.typeRegistry.resolve(typeId);

  if (descriptor.numbering?.onEnterStatus === document.status && document.number == null) {
    const numbered = await takeDocumentNumberForTransition(companyId, typeId, document.id);
    if (numbered) {
      document = { ...document, ...numbered };
    }
  }

  // Reused, not duplicated: the exact HTML->PDF pipeline "GET /documents/:id/pdf" uses, and the
  // SAME totals/referenceLabels/companyName the email template below is built from — one render,
  // one totals computation, one reference-label resolution pass for the whole send.
  const rendered = await renderDocumentInstance(
    { referenceRegistry: deps.referenceRegistry },
    companyId,
    descriptor,
    document,
  );

  const companyTemplates = await getCompanyDocumentEmailTemplates(companyId);
  const template = resolveEmailTemplate(descriptor, companyTemplates);
  const parts = buildEmailTemplateParts({
    descriptor,
    displayNumber: document.displayNumber,
    companyName: rendered.companyName,
    totals: rendered.totals,
    referenceLabels: rendered.referenceLabels,
  });
  const { subject, body, warnings } = renderEmailTemplate(template, parts);

  for (const warning of warnings) {
    logger.warn(`Document email template: ${warning}`, {
      category: 'documents',
      details: { companyId, typeId, documentId: document.id },
    });
  }

  const filename = document.displayNumber ? `${document.displayNumber}.pdf` : `${typeId}-${document.id}.pdf`;

  await deps.mailService.sendMail({
    to: recipient,
    subject,
    text: body,
    attachments: [{ filename, content: rendered.pdf, contentType: 'application/pdf' }],
  });

  const message = `${label} sent to ${recipient}.${warnings.length > 0 ? ` (${warnings.join(' ')})` : ''}`;
  return { message };
}
