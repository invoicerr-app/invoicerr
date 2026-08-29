import { ActionExtensionRegistry } from './action-extensions';
import { ActionRegistry } from './action-registry';
import { findOwnedDocument, upsertDocument } from '../persistence';

/**
 * A THIRD-PARTY extension, deliberately kept in its own file: it never imports, and is never
 * imported by, quote.descriptor.ts or quote-actions.ts. It attaches a generic "duplicate" action —
 * copy this record's current data into a brand-new draft — to any document type it is wired for
 * (see documents.module.ts). This is the proof of the extensibility mechanism the task asks for:
 * adding "duplicate" to the quote touches THIS file and its one line of wiring, nothing that belongs
 * to the quote type itself.
 *
 * Declaration (ActionExtensionRegistry) and implementation (ActionRegistry) are registered together
 * here for convenience, but they are still two independent steps — a plugin could just as well
 * declare this action and never register a handler, and it would 501 exactly like any other
 * unimplemented action. Nothing about the mechanism special-cases "duplicate".
 */
export function registerDuplicateExtension(
  typeId: string,
  extensions: ActionExtensionRegistry,
  actions: ActionRegistry,
): void {
  extensions.register(typeId, {
    id: 'duplicate',
    label: 'Duplicate',
    // A record has to exist and be persisted before there is anything to copy.
    availableWhen: ['draft', 'sent'],
  });

  actions.register(typeId, 'duplicate', async ({ companyId, documentId }) => {
    if (!documentId) {
      // Unreachable in practice — `availableWhen` above already refuses this before the handler
      // runs — but a handler never trusts that alone; see documents.service.ts's own comment on why
      // the 409 check exists server-side regardless of what the UI offers.
      throw new Error('Cannot duplicate a document that has not been saved yet.');
    }

    const source = await findOwnedDocument(companyId, typeId, documentId);
    const clonedData = source.data as Record<string, unknown>;
    const document = await upsertDocument(companyId, typeId, undefined, 'draft', clonedData);

    return { document, changed: true, message: 'Duplicated as a new draft.' };
  });
}
