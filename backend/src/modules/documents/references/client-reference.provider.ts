import { ClientsService } from '@/modules/clients/clients.service';

import { EntityReferenceOption, EntityReferenceProvider } from './reference-registry';

function labelFor(client: {
  name: string;
  contactFirstname: string | null;
  contactLastname: string | null;
}): string {
  if (client.name) return client.name;
  return [client.contactFirstname, client.contactLastname].filter(Boolean).join(' ') || '(unnamed client)';
}

export interface ClientReferenceProviderOptions {
  /**
   * TODO_PRODUIT.md T5(b) — set on the "client" entity ONLY (`documents-core.module.ts`'s
   * `buildEntityReferenceRegistry`), never on "supplier": the invoice's/quote's own `client` field is
   * the BILLABLE picker, and a pure supplier (`Client.isSupplier`) is noise there — this company does
   * not invoice its own suppliers through that field. The "supplier" entity (received-invoice's own
   * `supplierClient` field) reuses the exact same `Client` table with NO such exclusion: any client
   * can become a supplier, and one already flagged must stay findable so a SECOND received invoice
   * can be linked to it by hand. `resolve()` below is NEVER filtered either way — an already-set
   * reference (a client invoiced before being flagged a supplier, or vice versa) must keep resolving
   * to its label regardless of the CURRENT flag, the same "resolve never filters" contract `kind`
   * (GOVERNMENT) already established for this exact provider.
   */
  excludeSuppliers?: boolean;
}

/** Wraps the existing ClientsService — the document descriptor system adds no client-specific
 *  logic of its own, only this thin adapter to its generic EntityReferenceOption shape. */
export function buildClientReferenceProvider(
  clientsService: ClientsService,
  options?: ClientReferenceProviderOptions,
): EntityReferenceProvider {
  return {
    async search(companyId, query): Promise<EntityReferenceOption[]> {
      const clients = await clientsService.searchClients(companyId, query, {
        excludeSuppliers: options?.excludeSuppliers,
      });
      return clients.map((client) => ({ id: client.id, label: labelFor(client) }));
    },
    async resolve(companyId, id): Promise<EntityReferenceOption | null> {
      const client = await clientsService.getClientById(companyId, id);
      return client ? { id: client.id, label: labelFor(client) } : null;
    },
  };
}
