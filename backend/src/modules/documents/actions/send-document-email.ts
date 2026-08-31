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
 * own unconditional "send" (quote-actions.ts) and the invoice's "email" transport
 * (transports/email-transport.ts). Neither caller is merged into the other by this: each still
 * decides ON ITS OWN whether/how it is even reachable (the quote always emails; the invoice only
 * gets here if the company chose the "email" transport — see invoice-actions.ts) and, most
 * importantly, WHO the recipient is (`input.recipient` — typed by the user for the quote, resolved
 * from the client's contact email for the invoice). Only the "compose + attach + send" mechanics
 * below are actually shared — see actions/send-divergence.spec.ts for the guardrail proving the two
 * callers still never share an ADDRESSING or transport decision.
 *
 * ## Numbering — a defensive fallback, not the primary mechanism anymore
 *
 * Before TODO.md item 22 (the async-send queue), a type's `numbering.onEnterStatus` was the SAME
 * status "send" delivered to synchronously, so this function had to pull the number FORWARD itself
 * (documents.service.ts's `runAction` only numbers a document AFTER its handler returns). Since item
 * 22, `onEnterStatus` is "sending" (see e.g. quote.descriptor.ts) and BOTH callers (actions/async-send.ts's
 * `runAsyncSendAction`) only ever invoke this function once the record is ALREADY "sending" — meaning
 * `runAction`'s own post-handler numbering hook already ran, on the FIRST ("sending") call, strictly
 * before this SECOND call (the actual delivery) is even reachable. In the normal flow `document` is
 * therefore always already numbered by the time this guard is checked, and it is a no-op. It is kept,
 * deliberately, as a defensive fallback — never load-bearing, but harmless (`takeDocumentNumberForTransition`
 * is itself a DB-level "number IS NULL" guard, so calling it on an already-numbered document is
 * inert) — for any caller that reaches this function DIRECTLY, outside `runAsyncSendAction` entirely
 * (send-quote.live.spec.ts does exactly that, against a pre-numbered document, to keep this function's
 * own coverage independent of the action-registry wiring).
 *
 * ## PDF failure — fails LOUDLY, never a silent send without the attachment
 *
 * If `renderDocumentInstance` throws (e.g. Puppeteer unavailable), this function does NOT catch it
 * and fall back to sending a bare email: the error propagates straight out, `mailService.sendMail` is
 * NEVER called, and the caller's whole delivery attempt fails with the render engine's own message. A
 * commercial email promising a document with no document actually attached is a worse failure mode
 * than a delayed one — the same "blocked, and says so" discipline invoice-actions.ts already holds
 * for a missing transport. See actions/send-document-email.spec.ts's "a PDF failure never sends a
 * bare email" coverage — mocking `renderDocumentInstance` itself (the entry point this function calls
 * into), never this function's own internals, so the test cannot pass for the wrong reason.
 *
 * This propagated error is also exactly what item 22's queue was BUILT to catch: this function is only
 * ever called from `runAsyncSendAction`'s `deliver` closure (actions/async-send.ts), which never
 * catches this error either — it propagates all the way out to BullMQ, which retries per its own
 * backoff and, once every attempt is exhausted, leaves the record "send_failed" with the error
 * recorded (queue/mark-send-failed.ts) rather than a "sent" document nobody ever received. This is the
 * fix for the gap this comment used to document here (TODO_ISSUES.md's own entry on it) — no longer
 * something this function's own header needs to carry, since the record is no longer written "sent"
 * until delivery has genuinely succeeded (see async-send.ts's own header for the full sequencing).
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
