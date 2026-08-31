import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { deleteDocument, upsertDocument } from '../persistence';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { ActionRegistry } from './action-registry';
import { sendDocumentInstanceEmail } from './send-document-email';

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
 * "delete": permanently removes an instance — generic for the exact same reason "save-draft" is:
 * nothing here reads a single field of `data`, so one function covers every document type that opts
 * in. Deliberately NOT wired for the quote/invoice/credit-note today: once a legal document exists,
 * whether it may ever be deleted (as opposed to corrected, e.g. by a credit note) is plausibly a
 * question with its own jurisdiction-specific answer — exactly the kind of rule this branch is
 * careful not to invent by default (see invoice.descriptor.ts's own "deliberately NOT added"
 * section). "expense" (expense-actions.ts) is the first, deliberately narrow, use: a mis-entered
 * expense is bookkeeping housekeeping, not a document whose deletion raises that question.
 */
export function registerDeleteAction(registry: ActionRegistry, typeId: string): void {
  registry.register(typeId, 'delete', async ({ companyId, documentId }) => {
    if (!documentId) {
      // Unreachable in practice — the descriptor's own `availableWhen` already refuses this before
      // the handler runs (a never-saved record has no status to match) — but a handler never trusts
      // that alone, the same discipline duplicate-extension.ts documents.
      throw new Error(`Cannot delete a "${typeId}" document that has not been saved yet.`);
    }

    await deleteDocument(companyId, typeId, documentId);
    return { changed: true, message: 'Deleted.' };
  });
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

/** Everything `registerEmailSendAction` needs to compose and deliver the email — see
 *  actions/send-document-email.ts's own header for the full "compose PDF + template + send"
 *  contract this is handed to unchanged. */
export interface EmailSendActionDeps {
  mailService: MailService;
  typeRegistry: DocumentTypeRegistry;
  referenceRegistry: EntityReferenceRegistry;
}

/**
 * Registers "send" as an unconditional email — see `registerEmailRecipientDefaultFromClient`'s
 * comment above for which document types this is actually appropriate for (the quote; deliberately
 * NOT the invoice). `label` (e.g. "Quote") is plain data used only for the confirmation message and
 * (via the email template's `{typeLabel}`) the subject — the same convention
 * DocumentTypeDescriptor.label already follows, not an i18n key.
 *
 * The actual email — PDF attached, subject/body from the type's (or company-overridden) template —
 * is composed by `sendDocumentInstanceEmail` (send-document-email.ts), shared with the invoice's
 * "email" transport; see that function's own header for the numbering-pulled-forward and
 * PDF-failure-fails-loudly behavior this action inherits by calling it.
 */
export function registerEmailSendAction(
  registry: ActionRegistry,
  typeId: string,
  label: string,
  deps: EmailSendActionDeps,
): void {
  registry.register(typeId, 'send', async ({ companyId, documentId, data, params }) => {
    // `params.recipient` is already validated (required, non-empty text) by DocumentsService.runAction
    // before this handler ever runs — same trust boundary "save-draft" already has for `data`.
    const recipient = params.recipient as string;
    const document = await upsertDocument(companyId, typeId, documentId, 'sent', data);

    const { message } = await sendDocumentInstanceEmail(deps, {
      companyId,
      typeId,
      document,
      recipient,
      label,
    });

    return { document, changed: true, message };
  });
}
