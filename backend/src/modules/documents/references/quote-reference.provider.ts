import { NotFoundException } from '@nestjs/common';

import { ClientsService } from '@/modules/clients/clients.service';

import { findOwnedDocument, listDocuments } from '../persistence';
import { EntityReferenceOption, EntityReferenceProvider } from './reference-registry';

const QUOTE_TYPE_ID = 'quote';

/**
 * A human label for a quote instance, built only from what is already stored on it (its client, its
 * issue date) — never a computed total or anything fiscal, which this module has no business
 * deriving. Falls back to the bare id when neither is available (a quote with no client set yet, or
 * one whose client was since deleted), so a label always renders.
 */
async function labelFor(
  clientsService: ClientsService,
  companyId: string,
  quote: { id: string; data: unknown },
): Promise<string> {
  const data = (quote.data ?? {}) as Record<string, unknown>;
  const issueDate = typeof data.issueDate === 'string' ? data.issueDate.slice(0, 10) : undefined;
  const clientId = typeof data.client === 'string' ? data.client : undefined;
  const client = clientId ? await clientsService.getClientById(companyId, clientId) : null;

  return [client?.name, issueDate].filter(Boolean).join(' — ') || `Quote ${quote.id}`;
}

/**
 * Points a 'reference' field at another document TYPE's own instances, rather than at a business
 * entity from an existing service — the only case client-reference.provider.ts proves. This is what
 * lets the invoice descriptor's "origin quote" field (invoice.descriptor.ts) reuse the exact same
 * 'reference' kind and the exact same generic /documents/references/:entity/... endpoints: the
 * registry only cares that SOMETHING implements search/resolve for the name "quote", and it does not
 * matter to it that this "something" reads the very same DocumentInstance table the quote type
 * itself is persisted through (persistence.ts), scoped by company exactly like every other read here.
 *
 * `search` does not filter server-side on the stored JSON `data` (there is no per-field index on it,
 * and building one would be a schema decision well beyond this task) — it fetches the company's most
 * recent quotes (persistence.listDocuments, already capped) and filters in memory on the resolved
 * label. Good enough for a picker; not a general-purpose search.
 */
export function buildQuoteReferenceProvider(clientsService: ClientsService): EntityReferenceProvider {
  return {
    async search(companyId, query): Promise<EntityReferenceOption[]> {
      const quotes = await listDocuments(companyId, QUOTE_TYPE_ID);
      const options = await Promise.all(
        quotes.map(async (quote) => ({
          id: quote.id,
          label: await labelFor(clientsService, companyId, quote),
        })),
      );

      if (!query) return options;
      const needle = query.toLowerCase();
      return options.filter((option) => option.label.toLowerCase().includes(needle));
    },

    async resolve(companyId, id): Promise<EntityReferenceOption | null> {
      try {
        const quote = await findOwnedDocument(companyId, QUOTE_TYPE_ID, id);
        return { id: quote.id, label: await labelFor(clientsService, companyId, quote) };
      } catch (error) {
        if (error instanceof NotFoundException) return null;
        throw error;
      }
    },
  };
}
