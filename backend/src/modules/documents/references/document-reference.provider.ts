import { NotFoundException } from '@nestjs/common';

import { ClientsService } from '@/modules/clients/clients.service';

import { findOwnedDocument, listDocuments } from '../persistence';
import { EntityReferenceOption, EntityReferenceProvider } from './reference-registry';

/**
 * A human label for a document instance, built only from what is already stored on it (its client,
 * its issue date) — never a computed total or anything fiscal, which this module has no business
 * deriving. Falls back to the bare id when neither is available (a document with no client set yet,
 * or one whose client was since deleted), so a label always renders.
 */
async function labelFor(
  clientsService: ClientsService,
  companyId: string,
  document: { id: string; data: unknown },
  typeLabel: string,
): Promise<string> {
  const data = (document.data ?? {}) as Record<string, unknown>;
  const issueDate = typeof data.issueDate === 'string' ? data.issueDate.slice(0, 10) : undefined;
  const clientId = typeof data.client === 'string' ? data.client : undefined;
  const client = clientId ? await clientsService.getClientById(companyId, clientId) : null;

  return [client?.name, issueDate].filter(Boolean).join(' — ') || `${typeLabel} ${document.id}`;
}

/**
 * Points a 'reference' field at another document TYPE's own instances, rather than at a business
 * entity from an existing service — the only case client-reference.provider.ts proves. This is what
 * lets a document descriptor's own reference fields (the invoice's "origin", the credit note's
 * "invoice") reuse the exact same 'reference' kind and the exact same generic
 * /documents/references/:entity/... endpoints: the registry only cares that SOMETHING implements
 * search/resolve for a given name, and it does not matter to it that this "something" reads the very
 * same DocumentInstance table the type itself is persisted through (persistence.ts), scoped by
 * company exactly like every other read here.
 *
 * Generic over `typeId` on purpose: this file used to be quote-reference.provider.ts, hard-coded to
 * "quote" — the only thing that changed to make the invoice's "origin" field able to target ANOTHER
 * INVOICE too (see invoice.descriptor.ts, entities: ['quote', 'invoice']) was calling this factory
 * once per typeId (documents.module.ts) instead of writing a second, near-identical file. Nothing
 * about the multi-target 'reference' field kind (field-kinds.ts, types.ts) required this — it was
 * already generic; only the set of REGISTERED providers needed to grow by one call.
 *
 * `search` does not filter server-side on the stored JSON `data` (there is no per-field index on it,
 * and building one would be a schema decision well beyond this task) — it fetches the company's most
 * recent instances of this type (persistence.listDocuments, already capped) and filters in memory on
 * the resolved label. Good enough for a picker; not a general-purpose search.
 */
export function buildDocumentReferenceProvider(
  typeId: string,
  typeLabel: string,
  clientsService: ClientsService,
): EntityReferenceProvider {
  return {
    async search(companyId, query): Promise<EntityReferenceOption[]> {
      const documents = await listDocuments(companyId, typeId);
      const options = await Promise.all(
        documents.map(async (document) => ({
          id: document.id,
          label: await labelFor(clientsService, companyId, document, typeLabel),
        })),
      );

      if (!query) return options;
      const needle = query.toLowerCase();
      return options.filter((option) => option.label.toLowerCase().includes(needle));
    },

    async resolve(companyId, id): Promise<EntityReferenceOption | null> {
      try {
        const document = await findOwnedDocument(companyId, typeId, id);
        return { id: document.id, label: await labelFor(clientsService, companyId, document, typeLabel) };
      } catch (error) {
        if (error instanceof NotFoundException) return null;
        throw error;
      }
    },
  };
}
