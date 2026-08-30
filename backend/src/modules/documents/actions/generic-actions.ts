import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { upsertDocument } from '../persistence';
import { ActionRegistry, DocumentInstanceResult } from './action-registry';

/**
 * Registration helpers shared by every document type that has an ordinary "save the current fields
 * as a draft" action and a "send it by email" action addressed through a `client` reference field —
 * the quote, and now the invoice. Extracted here so that adding the SECOND document type with a
 * "send" action did not mean writing a second copy of it: quote-actions.ts and invoice-actions.ts
 * each now supply only what is genuinely type-specific (the email body text), and call these three
 * functions for everything else. This is the "réutilise le mécanisme existant, ne le duplique pas"
 * rule applied to the one action both types share.
 */

/**
 * "save-draft": persist `data` under status "draft", creating a new instance the first time this
 * runs for a given record. Nothing here reads a single field of `data` — which is exactly why one
 * function covers every document type, whatever shape its fields have.
 */
export function registerSaveDraftAction(registry: ActionRegistry, typeId: string): void {
  registry.register(typeId, 'save-draft', async ({ companyId, documentId, data }) => ({
    document: await upsertDocument(companyId, typeId, documentId, 'draft', data),
    changed: true,
  }));
}

/**
 * Pre-fills a "send" action's `recipient` param from the client referenced by the document's own
 * `client` field. The one piece of type-specific knowledge this needs is the field's KEY ("client"),
 * not its kind or how it renders — every document type that reuses this must name its client field
 * `client`, the same way the quote and invoice descriptors both do. `data.client` is the id a
 * 'reference' field stores, not yet an email.
 */
export function registerSendRecipientDefaultFromClient(
  registry: ActionRegistry,
  typeId: string,
  clientsService: ClientsService,
): void {
  registry.registerParamsDefaults(typeId, 'send', async ({ companyId, data }) => {
    const clientId = typeof data.client === 'string' ? data.client : undefined;
    if (!clientId) return {};
    const client = await clientsService.getClientById(companyId, clientId);
    return client?.contactEmail ? { recipient: client.contactEmail } : {};
  });
}

/**
 * Registers "send": mark the document "sent" and email `buildEmailText(document)` to
 * `params.recipient`. `label` (e.g. "Quote", "Invoice") is plain data used only for the subject line
 * and the confirmation message — the same convention DocumentTypeDescriptor.label already follows,
 * not an i18n key.
 */
export function registerSendAction(
  registry: ActionRegistry,
  typeId: string,
  label: string,
  buildEmailText: (document: DocumentInstanceResult) => string,
  mailService: MailService,
): void {
  registry.register(typeId, 'send', async ({ companyId, documentId, data, params }) => {
    // `params.recipient` is already validated (required, non-empty text) by DocumentsService.runAction
    // before this handler ever runs — same trust boundary "save-draft" already has for `data`.
    const recipient = params.recipient as string;
    const document = await upsertDocument(companyId, typeId, documentId, 'sent', data);

    await mailService.sendMail({
      to: recipient,
      subject: `${label} ${document.id}`,
      text: buildEmailText(document),
    });

    return { document, changed: true, message: `${label} sent to ${recipient}.` };
  });
}
