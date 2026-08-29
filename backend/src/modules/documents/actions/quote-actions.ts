import { upsertDocument } from '../persistence';
import { ActionRegistry } from './action-registry';

/**
 * Registers the quote type's action IMPLEMENTATIONS. Note what is and isn't here: "save-draft" is
 * registered; "send" is declared on the descriptor (quote.descriptor.ts) but is deliberately NOT
 * registered — sending a quote needs an email/PDF pipeline this branch does not build, and the
 * point of this registry is that an unimplemented-but-declared action is blocked with a clear
 * error (DocumentsService.runAction), never silently accepted or silently dropped.
 */
export function registerQuoteActions(registry: ActionRegistry): void {
  registry.register('quote', 'save-draft', ({ companyId, typeId, documentId, data }) =>
    upsertDocument(companyId, typeId, documentId, 'draft', data),
  );
}
