/**
 * Supplier reconciliation for received invoices: reuse `Client` with a role rather than a
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
 *    ts`'s own `upload()`) against whatever `extraction.ts` read off the deposited file. "On upload"
 *    means exactly this: the moment the file's own supplier VAT/name become
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
 * Never creates a Client — the one rule this module could
 * most easily violate by accident: a deposit whose vendor matches NOTHING (no VAT hit, no exact name
 * hit) returns `unmatched` and leaves `data.supplierClient` unset — the screen offers to choose or
 * create one exactly the way `invoice.descriptor.ts`'s own `client` field already does (there is no
 * inline "create a client from here" shortcut for THAT field either), never a silent, guessed link.
 */
import prisma from '@/prisma/prisma.service';

import { ClientMatchResult, matchClientByVatThenName } from '../client-book-match';

export interface SupplierMatchCriteria {
  /** Raw text off `extraction.ts`'s own `supplierVatId` (RAM `SpecifiedTaxRegistration/ID` / UBL
   *  `PartyTaxScheme/CompanyID`) — compared normalized (whitespace stripped, uppercased): a VAT
   *  number is the SAME identifier however it was typed or printed, so a cosmetic formatting
   *  difference between what a supplier's own system emitted and what this company typed into its
   *  client book must never defeat an otherwise-real match. */
  vatId?: string;
  /** Raw text off `extraction.ts`'s own `supplier` (the seller's name) — compared EXACTLY (trimmed,
   *  case-SENSITIVE): "if the name matches exactly", read literally on
   *  purpose. Unlike a VAT number, a company name has no canonical normalized form this codebase can
   *  safely assume (case folding "Dupont" against "DUPONT" is far more likely to coincidentally
   *  collide two UNRELATED entities than a VAT checksum ever would) — exact-or-nothing is the honest,
   *  conservative reading of "exactly", not a shortcut. */
  supplierName?: string;
}

export type SupplierMatchResult = ClientMatchResult;

/**
 * Matches a deposited invoice's supplier against THIS company's own client book — never another
 * company's (every query below is scoped by `companyId`, the same multi-tenancy discipline as every
 * other read in this codebase), and never a soft-deleted client (`isActive: false` — resurrecting a
 * deleted client via an incoming invoice would be a stranger surprise than simply asking the user to
 * pick one). VAT is tried FIRST ("VAT-first"), name as the fallback, an ambiguous VAT hit never
 * falling through to a name guess: the rule lives in `../client-book-match.ts`, shared with the
 * import's buyer matching.
 */
export async function reconcileSupplierClient(
  companyId: string,
  criteria: SupplierMatchCriteria,
): Promise<SupplierMatchResult> {
  return matchClientByVatThenName(companyId, { vatId: criteria.vatId, name: criteria.supplierName });
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
