import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

import { ClientsService } from '@/modules/clients/clients.service';
import { logger } from '@/logger/logger.service';

import { deleteDocument, upsertDocument } from '../persistence';
import { buildDocumentWebhookPayload, DocumentWebhookEmitter } from '../queue/document-webhooks';
import { ActionRegistry } from './action-registry';

/**
 * The actual "save-draft" WORK: persist `data` under status "draft", creating a new instance the
 * first time this runs for a given record, and fire `DOCUMENT_CREATED` on that first time only.
 * Extracted from `registerSaveDraftAction` below (TODO_PRODUIT.md T4-c) so `invoice-actions.ts` can
 * reuse the exact same persistence + webhook mechanics from its OWN "save-draft" handler — one that
 * needs to run one extra check first (see that file's own comment) — without duplicating this glue.
 * Nothing here reads a single field of `data`, which is exactly why one function still covers every
 * document type regardless of which caller invokes it.
 */
export async function performSaveDraft(
  companyId: string,
  typeId: string,
  documentId: string | undefined,
  data: Record<string, unknown>,
  webhooks?: DocumentWebhookEmitter,
) {
  const creating = !documentId;
  const document = await upsertDocument(companyId, typeId, documentId, 'draft', data);
  if (creating && webhooks) {
    try {
      await webhooks.dispatch(
        WebhookEvent.DOCUMENT_CREATED,
        buildDocumentWebhookPayload(companyId, typeId, document),
      );
    } catch (error) {
      logger.error('Failed to dispatch a DOCUMENT_CREATED webhook — the document was still created', {
        category: 'documents',
        details: {
          companyId,
          typeId,
          documentId: document.id,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return { document, changed: true };
}

/**
 * "save-draft": persist `data` under status "draft", creating a new instance the first time this
 * runs for a given record. Legitimately shared by every document type this branch has (quote,
 * credit note, expense, received-invoice): persisting a draft's field values has nothing to do with
 * WHERE the document eventually travels, unlike "send" below. The INVOICE is the one exception —
 * `invoice-actions.ts` registers its own "save-draft" handler instead of calling this (see that
 * file's own comment, TODO_PRODUIT.md T4-c) because re-editing an already-issued invoice back into
 * a draft needs one extra, invoice-specific check this generic function has no business knowing
 * about; it still calls `performSaveDraft` above for the actual persistence, so the two never drift.
 *
 * `webhooks` (TODO_PRODUIT.md T2bis) is OPTIONAL, the same "no capability, no effect" posture
 * `async-send.ts`'s own `webhooks` field holds — fires `DOCUMENT_CREATED` exactly once per record,
 * the FIRST time this runs for it (`documentId` absent on entry — `upsertDocument` branches on the
 * exact same test to decide create vs. update, so this reuses that same signal rather than
 * re-deriving "was this a create" from the result). Never on an ordinary re-save of an existing
 * draft: a "save-draft" replayed for the same record is an UPDATE, not a new fact.
 */
export function registerSaveDraftAction(
  registry: ActionRegistry,
  typeId: string,
  webhooks?: DocumentWebhookEmitter,
): void {
  registry.register(typeId, 'save-draft', async ({ companyId, documentId, data }) =>
    performSaveDraft(companyId, typeId, documentId, data, webhooks),
  );
}

/**
 * "delete": permanently removes an instance — generic for the exact same reason "save-draft" is:
 * nothing here reads a single field of `data`, so one function covers every document type that opts
 * in. Deliberately NOT wired for the quote/invoice/credit-note today: once a legal document exists,
 * whether it may ever be deleted (as opposed to corrected, e.g. by a credit note) is plausibly a
 * question with its own jurisdiction-specific answer — exactly the kind of rule this branch is
 * careful not to invent by default (see invoice.descriptor.ts's own "deliberately NOT added"
 * section). "expense" (expense-actions.ts) and "received-invoice" (received-invoice-actions.ts) are
 * its two uses today.
 *
 * `webhooks` (TODO_PRODUIT.md T2bis) — same optional posture as `registerSaveDraftAction` above.
 * `deleteDocument` (persistence.ts) returns the row AS IT WAS the instant before removal — the only
 * possible value for `document` in a `DOCUMENT_DELETED` payload, since the row no longer exists to
 * re-read afterward.
 */
export function registerDeleteAction(
  registry: ActionRegistry,
  typeId: string,
  webhooks?: DocumentWebhookEmitter,
): void {
  registry.register(typeId, 'delete', async ({ companyId, documentId }) => {
    if (!documentId) {
      // Unreachable in practice — the descriptor's own `availableWhen` already refuses this before
      // the handler runs (a never-saved record has no status to match) — but a handler never trusts
      // that alone, the same discipline duplicate-extension.ts documents.
      throw new Error(`Cannot delete a "${typeId}" document that has not been saved yet.`);
    }

    const document = await deleteDocument(companyId, typeId, documentId);
    if (webhooks) {
      try {
        await webhooks.dispatch(
          WebhookEvent.DOCUMENT_DELETED,
          buildDocumentWebhookPayload(companyId, typeId, document),
        );
      } catch (error) {
        logger.error('Failed to dispatch a DOCUMENT_DELETED webhook — the document was still deleted', {
          category: 'documents',
          details: {
            companyId,
            typeId,
            documentId,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
    return { changed: true, message: 'Deleted.' };
  });
}

/**
 * The QUOTE's OWN "recipient" params-default resolver — NOT a generic "how any document type sends"
 * mechanism, even though it lives in this "generic-actions.ts" file and even though its shape (a
 * registry, a typeId parameter) looks exactly as reusable as `registerSaveDraftAction` above. What it
 * pre-fills (a typed "recipient" param) used to be paired with this file's own `registerEmailSendAction`
 * — the quote's unconditional, synchronous email send — which item 22 (TODO.md) replaced with the
 * asynchronous two-phase shape every type with a "send" now shares (actions/async-send.ts); see
 * quote-actions.ts for where "send" itself is registered today. This resolver survives that change
 * UNCHANGED: pre-filling a typed recipient from the document's own client has nothing to do with
 * whether the actual delivery is synchronous or queued.
 *
 * BEFORE reusing this for a new document type: ask whether that type's delivery is genuinely,
 * unconditionally "always email" the way the quote's is — a signed quote going to one known
 * counterparty by email is a defensible default. The moment delivery could plausibly depend on
 * configuration, jurisdiction, or a company setting, it needs its own mechanism reading that
 * configuration (invoice-actions.ts is the template for that shape), not this one.
 * documents.service.spec.ts's "quote and invoice use a different send path" coverage is the test that
 * is meant to go red the day this guidance is ignored.
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
