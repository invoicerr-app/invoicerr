/**
 * The one rule that matches a party named on a document against THIS company's own client book:
 * VAT first, exact name as the fallback, an ambiguous hit named as such rather than silently resolved.
 * Two callers, one per side of a document:
 *  - `received-invoices/supplier-reconciliation.ts#reconcileSupplierClient`: the SELLER of a received
 *    invoice, matched at upload time;
 *  - `import/einvoice-import-prefill.ts#buildImportPrefill`: the BUYER of a structured import file
 *    (issue #758).
 * Before this module each held its own copy ("Mirrors ... exactly"), so the rule could drift between
 * reception and import without anything noticing.
 *
 * Reaching `prisma` directly, not `ClientsService`, is deliberate: a cross-domain READ from inside
 * `documents/`, with no write, for the reason `supplier-reconciliation.ts`'s own header gives.
 */
import prisma from '@/prisma/prisma.service';

/** How many of this company's own VAT identifiers / same-named clients are scanned for a match - the
 *  same bounded, honest-linear-scan discipline `received-invoices.service.ts`'s own
 *  `DUPLICATE_CHECK_LIMIT` already uses for the identical reason: this is a per-document
 *  reconciliation check, not a hot read path, and 1000 comfortably covers any real company's client
 *  book. A company with MORE than this many VAT-bearing clients degrades to "not found" rather than a
 *  slow scan - never a wrong match, only a missed one, which the screen's own manual fallback still
 *  covers. */
const MATCH_SCAN_LIMIT = 1000;

export type ClientMatchResult =
  | { outcome: 'matched'; clientId: string; matchedBy: 'vat' | 'name' }
  | { outcome: 'unmatched'; reason: 'no-criteria' | 'not-found' }
  /** Deliberately NOT a variant of `unmatched`: an ambiguous match is a DIFFERENT fact than "nothing
   *  matched" - this company DOES already know of a candidate (or several), it just cannot pick ONE
   *  safely. Named separately so a caller (and its tests) can tell "never heard of this party" apart
   *  from "heard of it more than once" without inspecting `reason` strings. */
  | { outcome: 'ambiguous'; matchedBy: 'vat' | 'name'; candidateIds: string[] };

export interface ClientMatchCriteria {
  /** Compared normalized (whitespace stripped, uppercased): a VAT number is the SAME identifier
   *  however it was typed or printed. */
  vatId?: string;
  /** Compared EXACTLY (trimmed, case-SENSITIVE): a company name has no canonical normalized form this
   *  codebase can safely assume. */
  name?: string;
}

/** VAT numbers compare with whitespace stripped, case-insensitively - the only normalization; see
 *  `ClientMatchCriteria.vatId` above for why this (and ONLY this) field gets normalized. */
function normalizeVat(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/**
 * Matches against THIS company's own client book - never another company's (every query below is
 * scoped by `companyId`), and never a soft-deleted client (`isActive: false`). VAT is tried FIRST and,
 * on a clean miss (zero identifier rows share the normalized value), name is tried as the fallback:
 * but an AMBIGUOUS vat match returns immediately as `ambiguous`, never silently falling through to a
 * name guess: the safest reading of "an identifier that points to two clients" is to name the
 * ambiguity, not to paper over it with a second, weaker heuristic.
 */
export async function matchClientByVatThenName(
  companyId: string,
  criteria: ClientMatchCriteria,
): Promise<ClientMatchResult> {
  const vatId = criteria.vatId?.trim();
  const name = criteria.name?.trim();

  if (vatId) {
    const normalized = normalizeVat(vatId);
    const identifiers = await prisma.partyIdentifier.findMany({
      where: { scheme: 'VAT', client: { companyId, isActive: true } },
      take: MATCH_SCAN_LIMIT,
      select: { value: true, clientId: true },
    });
    const candidates = Array.from(
      new Set<string>(
        identifiers
          .filter((identifier) => normalizeVat(identifier.value) === normalized)
          .map((identifier) => identifier.clientId)
          .filter((clientId): clientId is string => clientId !== null),
      ),
    );
    if (candidates.length === 1) {
      return { outcome: 'matched', clientId: candidates[0], matchedBy: 'vat' };
    }
    if (candidates.length > 1) {
      return { outcome: 'ambiguous', matchedBy: 'vat', candidateIds: candidates };
    }
    // Zero VAT matches - an honest miss, not an error: fall through to the name fallback below.
  }

  if (name) {
    const clients = await prisma.client.findMany({
      where: { companyId, isActive: true, name },
      take: MATCH_SCAN_LIMIT,
      select: { id: true },
    });
    if (clients.length === 1) {
      return { outcome: 'matched', clientId: clients[0].id, matchedBy: 'name' };
    }
    if (clients.length > 1) {
      return { outcome: 'ambiguous', matchedBy: 'name', candidateIds: clients.map((client) => client.id) };
    }
  }

  if (!vatId && !name) {
    return { outcome: 'unmatched', reason: 'no-criteria' };
  }
  return { outcome: 'unmatched', reason: 'not-found' };
}
