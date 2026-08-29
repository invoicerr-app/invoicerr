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

/** Wraps the existing ClientsService — the document descriptor system adds no client-specific
 *  logic of its own, only this thin adapter to its generic EntityReferenceOption shape. */
export function buildClientReferenceProvider(clientsService: ClientsService): EntityReferenceProvider {
  return {
    async search(companyId, query): Promise<EntityReferenceOption[]> {
      const clients = await clientsService.searchClients(companyId, query);
      return clients.map((client) => ({ id: client.id, label: labelFor(client) }));
    },
    async resolve(companyId, id): Promise<EntityReferenceOption | null> {
      const client = await clientsService.getClientById(companyId, id);
      return client ? { id: client.id, label: labelFor(client) } : null;
    },
  };
}
