/**
 * TODO_PRODUIT.md T5(b) — "rapprochement fournisseur des factures reçues". DÉCISION MANDANT (déjà
 * prise, consignée in the task's own board section): reuse `Client` with a role rather than a
 * dedicated entity. That role is `Client.isSupplier` — a plain, independent boolean, NEVER an
 * extension of `Client.kind` (BUSINESS/GOVERNMENT): `kind` is a B2G ROUTING fact about the OUTBOUND
 * direction (which channel/format an invoice TO this client must use); "is this company's own
 * supplier" is an orthogonal fact about the INBOUND direction. A government body can be a supplier
 * (buying stationery from the town hall's own print shop), and a supplier this company also invoices
 * back stays possible too — `kind` cannot carry both without inventing composite values for a fact it
 * was never about. See `schema.prisma`'s own `Client.isSupplier` comment for the same reasoning.
 *
 * Two pure(ish) operations, deliberately NOT wrapped behind `ClientsService`: this module reaches
 * `Client`/`PartyIdentifier` through the bare `prisma` singleton the same way `persistence.ts` and
 * `actions/company-email-templates.ts` already do for a cross-domain read/write from inside
 * `documents/` — see CLAUDE.md's own note, "ClientsModule inimportable sous ts-jest" (WebhooksModule
 * pulls in `@teever/ez-hook`, a pure-ESM package ts-jest cannot compile): depending on the whole
 * `ClientsModule`/`ClientsService` here would drag that chain into every spec that imports THIS file,
 * including `received-invoices.service.spec.ts` and `received-invoice-actions.ts`'s own tests.
 *
 *  - `reconcileSupplierClient` — READ-ONLY matching, run at UPLOAD time (`received-invoices.service.
 *    ts`'s own `upload()`) against whatever `extraction.ts` read off the deposited file. "au dépôt"
 *    (the task's own wording) means exactly this: the moment the file's own supplier VAT/name become
 *    known, not later at "receive" — by the time "receive" runs, the match (or its absence) has
 *    already flowed through as ordinary pre-filled form data (`fields.supplierClient`), the SAME
 *    mechanism every other extracted field already uses (`custom/received-invoice-upload-button.tsx`'s
 *    own `buildInitialData`). "receive" itself never re-runs this — see that action's own header.
 *  - `markClientAsSupplier` — the ONE-WAY write: setting `isSupplier: true` on whichever Client ends
 *    up linked (`data.supplierClient`), auto-matched OR chosen by hand — both paths converge on the
 *    exact same action handler (`actions/received-invoice-actions.ts`'s own "receive"), which is the
 *    only place the link ever becomes a persisted fact. Deliberately NEVER unsets the flag: a received
 *    invoice later re-linked to a DIFFERENT client does not prove the FIRST one stopped being a real
 *    supplier (it may have other received invoices of its own, past or future) — the honest, cheap
 *    rule is "once flagged, stays flagged" rather than a query over every other received invoice to
 *    decide whether unflagging would be safe.
 *
 * Never creates a Client. Root instruction, restated here because it is the one this module could
 * most easily violate by accident: a deposit whose vendor matches NOTHING (no VAT hit, no exact name
 * hit) returns `unmatched` and leaves `data.supplierClient` unset — the screen offers to choose or
 * create one exactly the way `invoice.descriptor.ts`'s own `client` field already does (there is no
 * inline "create a client from here" shortcut for THAT field either), never a silent, guessed link.
 */
import prisma from '@/prisma/prisma.service';

/** How many of this company's own VAT identifiers / same-named clients are scanned for a match — the
 *  same bounded, honest-linear-scan discipline `received-invoices.service.ts`'s own
 *  `DUPLICATE_CHECK_LIMIT` already uses for the identical reason: this is a per-upload reconciliation
 *  check, not a hot read path, and 1000 comfortably covers any real company's client book. A company
 *  with MORE than this many VAT-bearing clients degrades to "not found" rather than a slow scan —
 *  never a wrong match, only a missed one, which the screen's own manual fallback still covers. */
const SUPPLIER_MATCH_SCAN_LIMIT = 1000;

export interface SupplierMatchCriteria {
  /** Raw text off `extraction.ts`'s own `supplierVatId` (RAM `SpecifiedTaxRegistration/ID` / UBL
   *  `PartyTaxScheme/CompanyID`) — compared normalized (whitespace stripped, uppercased): a VAT
   *  number is the SAME identifier however it was typed or printed, so a cosmetic formatting
   *  difference between what a supplier's own system emitted and what this company typed into its
   *  client book must never defeat an otherwise-real match. */
  vatId?: string;
  /** Raw text off `extraction.ts`'s own `supplier` (the seller's name) — compared EXACTLY (trimmed,
   *  case-SENSITIVE): the task's own wording is "si le nom correspond exactement", read literally on
   *  purpose. Unlike a VAT number, a company name has no canonical normalized form this codebase can
   *  safely assume (case folding "Dupont" against "DUPONT" is far more likely to coincidentally
   *  collide two UNRELATED entities than a VAT checksum ever would) — exact-or-nothing is the honest,
   *  conservative reading of "exactement", not a shortcut. */
  supplierName?: string;
}

export type SupplierMatchResult =
  | { outcome: 'matched'; clientId: string; matchedBy: 'vat' | 'name' }
  | { outcome: 'unmatched'; reason: 'no-criteria' | 'not-found' }
  /** Deliberately NOT a variant of `unmatched`: an ambiguous match is a DIFFERENT fact than "nothing
   *  matched" — this company DOES already know of a candidate (or several), it just cannot pick ONE
   *  safely. Named separately so a caller (and this module's own tests) can tell "never heard of this
   *  vendor" apart from "heard of it more than once" without inspecting `reason` strings. */
  | { outcome: 'ambiguous'; matchedBy: 'vat' | 'name'; candidateIds: string[] };

/** VAT numbers compare on digits/letters only, case-insensitively — see `SupplierMatchCriteria.vatId`
 *  above for why this (and ONLY this) field gets normalized before comparison. */
function normalizeVat(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/**
 * Matches a deposited invoice's supplier against THIS company's own client book — never another
 * company's (every query below is scoped by `companyId`, the same multi-tenancy discipline as every
 * other read in this codebase), and never a soft-deleted client (`isActive: false` — resurrecting a
 * deleted client via an incoming invoice would be a stranger surprise than simply asking the user to
 * pick one). VAT is tried FIRST (the task's own "TVA en tête") and, on a clean miss (zero identifier
 * rows share the normalized value), name is tried as the fallback — but an AMBIGUOUS vat match returns
 * immediately as `ambiguous`, never silently falling through to a name guess: the safest reading of
 * "un identifiant qui pointe vers deux clients" is to name the ambiguity, not to paper over it with a
 * second, weaker heuristic.
 */
export async function reconcileSupplierClient(
  companyId: string,
  criteria: SupplierMatchCriteria,
): Promise<SupplierMatchResult> {
  const vatId = criteria.vatId?.trim();
  const supplierName = criteria.supplierName?.trim();

  if (vatId) {
    const normalized = normalizeVat(vatId);
    const identifiers = await prisma.partyIdentifier.findMany({
      where: { scheme: 'VAT', client: { companyId, isActive: true } },
      take: SUPPLIER_MATCH_SCAN_LIMIT,
      select: { value: true, clientId: true },
    });
    const matchingClientIds = new Set<string>(
      identifiers
        .filter((identifier) => normalizeVat(identifier.value) === normalized)
        .map((identifier) => identifier.clientId)
        .filter((clientId): clientId is string => clientId !== null),
    );
    const candidates = Array.from(matchingClientIds);
    if (candidates.length === 1) {
      return { outcome: 'matched', clientId: candidates[0], matchedBy: 'vat' };
    }
    if (candidates.length > 1) {
      return { outcome: 'ambiguous', matchedBy: 'vat', candidateIds: candidates };
    }
    // Zero VAT matches — an honest miss, not an error: fall through to the name fallback below.
  }

  if (supplierName) {
    const clients = await prisma.client.findMany({
      where: { companyId, isActive: true, name: supplierName },
      take: SUPPLIER_MATCH_SCAN_LIMIT,
      select: { id: true },
    });
    if (clients.length === 1) {
      return { outcome: 'matched', clientId: clients[0].id, matchedBy: 'name' };
    }
    if (clients.length > 1) {
      return { outcome: 'ambiguous', matchedBy: 'name', candidateIds: clients.map((client) => client.id) };
    }
  }

  if (!vatId && !supplierName) {
    return { outcome: 'unmatched', reason: 'no-criteria' };
  }
  return { outcome: 'unmatched', reason: 'not-found' };
}

/**
 * The ONE-WAY write — see this file's own header for why it never unsets. `updateMany` (not
 * `update`) scoped by BOTH `id` AND `companyId` in the same `where`: a `clientId` that does not
 * belong to this company matches zero rows and this silently no-ops, rather than either leaking a
 * cross-tenant write or needing a separate existence check first — the exact same "scope IS the
 * guard" shape `persistence.ts`'s own tenant-safe helpers already use.
 */
export async function markClientAsSupplier(companyId: string, clientId: string): Promise<void> {
  await prisma.client.updateMany({ where: { id: clientId, companyId }, data: { isSupplier: true } });
}
