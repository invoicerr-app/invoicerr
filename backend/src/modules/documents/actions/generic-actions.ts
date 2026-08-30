import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { upsertDocument } from '../persistence';
import { ActionRegistry, DocumentInstanceResult } from './action-registry';

/**
 * "save-draft": persist `data` under status "draft", creating a new instance the first time this
 * runs for a given record. Nothing here reads a single field of `data` — which is exactly why one
 * function covers every document type, whatever shape its fields have. Legitimately shared by every
 * document type this branch has (quote, invoice, credit note): persisting a draft's field values has
 * nothing to do with WHERE the document eventually travels, unlike "send" below.
 */
export function registerSaveDraftAction(registry: ActionRegistry, typeId: string): void {
  registry.register(typeId, 'save-draft', async ({ companyId, documentId, data }) => ({
    document: await upsertDocument(companyId, typeId, documentId, 'draft', data),
    changed: true,
  }));
}

/**
 * The QUOTE's OWN send-by-email mechanism — NOT a generic "how any document type sends" mechanism,
 * even though it lives in this "generic-actions.ts" file and even though its shape (a registry, a
 * typeId parameter) looks exactly as reusable as `registerSaveDraftAction` above. It used to be
 * shared with the invoice; that was the mistake this file's own history proves needs a guard against
 * repeating: an invoice's transport depends on the ISSUING COMPANY's own configuration (see
 * transports/transport-registry.ts and actions/invoice-actions.ts), never a default the framework
 * silently reaches for. A quote sending by email, unconditionally, is that type's OWN nature — a
 * design decision quote.descriptor.ts states plainly, not a fallback.
 *
 * BEFORE reusing `registerEmailSendAction`/`registerEmailRecipientDefaultFromClient` for a new
 * document type: ask whether that type's delivery is genuinely, unconditionally "always email" the
 * way the quote's is — a signed quote going to one known counterparty by email is a defensible
 * default. The moment delivery could plausibly depend on configuration, jurisdiction, or a company
 * setting, it needs its own mechanism reading that configuration (invoice-actions.ts is the template
 * for that shape), not this one. documents.service.spec.ts's "quote and invoice use a different send
 * path" coverage is the test that is meant to go red the day this guidance is ignored.
 */
export function registerEmailRecipientDefaultFromClient(
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
 * Registers "send" as an unconditional email — see `registerEmailRecipientDefaultFromClient`'s
 * comment above for which document types this is actually appropriate for (the quote; deliberately
 * NOT the invoice). `label` (e.g. "Quote") is plain data used only for the subject line and the
 * confirmation message — the same convention DocumentTypeDescriptor.label already follows, not an
 * i18n key.
 */
export function registerEmailSendAction(
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
