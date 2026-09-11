import prisma from '@/prisma/prisma.service';

/**
 * TODO_FEATURES.md rank 4 — resolves a batch of `Client.id`s to a human-readable label, for the
 * accounting export's own "client" column: a document's own `data.client` field (an invoice's/credit
 * note's billable party) is a bare id, never a name.
 *
 * Mirrors `references/client-reference.provider.ts`'s own (unexported) `labelFor` fallback chain
 * exactly — duplicated rather than imported: that file's helper is a private implementation detail of
 * the reference-picker adapter, which itself wraps `ClientsService`, a full Nest-injectable service
 * this plain, dependency-free module has no business instantiating by hand (see
 * accounting-export.service.ts's own header on why this whole feature needs no DI at all). A raw,
 * company-scoped `prisma.client` read is the honest, minimal alternative — the same "small dedicated
 * file, one prisma import" shape `persistence.ts`/`settlement/payments.ts`/`settlement/credits.ts`
 * already hold throughout this module.
 *
 * ONE query for however many distinct client ids the export's rows reference — the same "one query,
 * many rows" shape `settlement/payments.ts`'s own `sumPaidMinorByDocument` already holds. A client id
 * with no matching row (deleted since, or a data anomaly) is simply absent from the returned map —
 * callers fall back to the raw id, an honest default, never a crash over one bad reference.
 */
export async function resolveClientLabels(
  companyId: string,
  clientIds: readonly string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(clientIds)];
  if (uniqueIds.length === 0) return new Map();

  const clients = await prisma.client.findMany({
    where: { companyId, id: { in: uniqueIds } },
    select: { id: true, name: true, contactFirstname: true, contactLastname: true },
  });

  return new Map(clients.map((client) => [client.id, labelFor(client)]));
}

function labelFor(client: {
  name: string;
  contactFirstname: string | null;
  contactLastname: string | null;
}): string {
  if (client.name) return client.name;
  return [client.contactFirstname, client.contactLastname].filter(Boolean).join(' ') || '(unnamed client)';
}
