/**
 * Matches the BUYER party of a structured import file against this company's own client book
 * (issue #758). Mirrors `received-invoices/supplier-reconciliation.ts`'s own rule exactly, for the
 * opposite side of the document: VAT first, exact name as the fallback, an ambiguous hit named as
 * such rather than silently resolved. Kept as its own small read-only function (rather than
 * generalizing the supplier module, whose header explains why it deliberately avoids
 * `ClientsService`) so neither caller has to know about the other's party role.
 *
 * Reaching `prisma` directly is the same precedent `supplier-reconciliation.ts` documents: a
 * cross-domain READ from inside `documents/`, with no write and no `ClientsService` dependency.
 */
import prisma from '@/prisma/prisma.service';

import { ImportClientMatch } from './document-import.types';

/** Same bounded linear scan as the supplier matcher: a client book larger than this degrades to a
 *  missed match, never a wrong one, and the screen still lets the user pick a client by hand. */
const MATCH_SCAN_LIMIT = 1000;

function normalizeVat(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export interface BuyerMatchCriteria {
  vatId?: string;
  name?: string;
}

export async function matchBuyerClient(
  companyId: string,
  criteria: BuyerMatchCriteria,
): Promise<ImportClientMatch> {
  const vatId = criteria.vatId?.trim();
  const name = criteria.name?.trim();

  if (vatId) {
    const normalized = normalizeVat(vatId);
    const identifiers = await prisma.partyIdentifier.findMany({
      where: { scheme: 'VAT', client: { companyId, isActive: true } },
      take: MATCH_SCAN_LIMIT,
      select: { value: true, clientId: true },
    });
    const candidates: string[] = Array.from(
      new Set<string>(
        identifiers
          .filter((identifier) => normalizeVat(identifier.value) === normalized)
          .map((identifier) => identifier.clientId)
          .filter((clientId): clientId is string => clientId !== null),
      ),
    );
    if (candidates.length === 1) return { outcome: 'matched', clientId: candidates[0], matchedBy: 'vat' };
    if (candidates.length > 1) {
      return { outcome: 'ambiguous', matchedBy: 'vat', candidateIds: candidates };
    }
  }

  if (name) {
    const clients = await prisma.client.findMany({
      where: { companyId, isActive: true, name },
      take: MATCH_SCAN_LIMIT,
      select: { id: true },
    });
    if (clients.length === 1) return { outcome: 'matched', clientId: clients[0].id, matchedBy: 'name' };
    if (clients.length > 1) {
      return { outcome: 'ambiguous', matchedBy: 'name', candidateIds: clients.map((client) => client.id) };
    }
  }

  if (!vatId && !name) return { outcome: 'unmatched', reason: 'no-criteria' };
  return { outcome: 'unmatched', reason: 'not-found' };
}
