/**
 * The ONE bridge from a document instance to `DeclaredInvoice` (`declaration-provider.ts`) — deliberately
 * REUSING the exact same building blocks `formats/shared-build.ts#buildEuInvoiceForDocument` already
 * composes for the CII/UBL exports, rather than a second, parallel derivation:
 *
 *  - `totals/compute-totals.ts#computeDocumentTotals` for every arithmetic figure (net/VAT/gross,
 *    per line AND aggregated) — NEVER recomputed here.
 *  - `formats/shared-build.ts#extractLines` for each line's DESCRIPTIVE facts (description/quantity/
 *    unitPrice) — the SAME "which array field is the line array" detection the CII/UBL bridge relies
 *    on, matched to `totals.lines` by array index, the same convention `SemanticLineInput`'s own
 *    header documents.
 *  - `formats/party-snapshot.ts#companyToFormatParty`/`clientToFormatParty` (called by the CALLER,
 *    `reporting-runner.ts` — this file only ever receives the already-built `DocumentFormatParty`)
 *    for seller/buyer identity, and `@/utils/entity-identifiers#getIdentifier` for VAT/LEGAL_ID, the
 *    exact same helper `build-semantic-invoice.ts` itself uses.
 *
 * What is deliberately NOT reused: the full `EuInvoice` (UBL-tag-keyed) object
 * `buildSemanticInvoice` produces. NAV/myDATA's own wire formats have nothing to do with UBL's tag
 * names — building a `DeclaredInvoice` straight from the SAME pure inputs (totals + lines + parties)
 * `buildSemanticInvoice` itself starts from is simpler and no less honest than building the UBL
 * object first and then reverse-engineering NAV/myDATA fields back out of `cac:`/`cbc:` keys.
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import { fromMinor } from '@/utils/financial';
import { guessCountryCode } from '@/utils/country-name-to-iso';

import { DeclaredInvoice, DeclaredInvoiceLine, DeclaredParty } from './declaration-provider';
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { extractLines, toDateOnly } from '../formats/shared-build';
import { DocumentFormatParty } from '../formats/format-provider';
import { computeDocumentTotals } from '../totals/compute-totals';

/**
 * Thrown when a document with no number reaches a declaration (issue #497). A declaration is a legal
 * statement to a tax authority that THIS numbered document was issued; there is no honest value to
 * declare in place of a number, and the literal "DRAFT" this bridge used to send was a placeholder the
 * authority would have recorded as a real document number. Unreachable for a document numbered on its
 * way to "sent" (`actions/async-send.ts` numbers it BEFORE the "sent" write `report-on-send.ts` fires
 * on); reaching it means a document got to "sent" unnumbered, which must fail loudly, never declare.
 * Propagates like any other failure of `reporting-runner.ts#runReport`: retried by BullMQ, then
 * journaled `report:failed` with this message.
 */
export class UndeclarableDocumentError extends Error {}

function toDeclaredParty(party: DocumentFormatParty): DeclaredParty {
  return {
    name: party.name,
    countryCode: guessCountryCode(party.country ?? undefined),
    vatNumber: getIdentifier(party, 'VAT'),
    legalId: getIdentifier(party, 'LEGAL_ID'),
    address: party.address || '',
    city: party.city || '',
    postalCode: party.postalCode || '',
  };
}

export function buildDeclaredInvoice(
  typeId: string,
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber'>,
  seller: DocumentFormatParty,
  buyer: DocumentFormatParty,
): DeclaredInvoice {
  // Never a placeholder: see `UndeclarableDocumentError`'s own header. Checked first, before any
  // figure is computed, so nothing about an unnumbered document is ever assembled for declaration.
  const number = document.displayNumber?.trim();
  if (!number) {
    throw new UndeclarableDocumentError(
      `Refusing to declare ${typeId} ${document.id}: it has no number. A declaration names the issued ` +
        'document by its number, and this one was never numbered, so there is nothing lawful to declare.',
    );
  }

  const data = (document.data ?? {}) as Record<string, unknown>;
  const totals = computeDocumentTotals(descriptor, data);
  // Currency detection can fail (see `computeDocumentTotals`'s own header — a document with no
  // resolvable currency field still totals with a warning); a declarative report cannot omit a
  // currency the way an internal warning-only totals view can, so this falls back to EUR — the
  // single-currency assumption every shipped country-fields overlay already makes for a domestic
  // seller (never silently guessed as the DOCUMENT's own true currency, only as what this report
  // labels amounts with when the document itself never said).
  const currency = totals.currency ?? 'EUR';
  const lineDescriptions = extractLines(data);

  const lines: DeclaredInvoiceLine[] = totals.lines.map((lineTotal, index) => {
    const description = lineDescriptions[index];
    return {
      description: description?.description ?? '',
      quantity: description?.quantity ?? 0,
      unitPrice: description?.unitPrice ?? 0,
      vatRatePercent: lineTotal.vatRatePercent,
      netAmount: fromMinor(lineTotal.netMinor, currency),
      vatAmount: fromMinor(lineTotal.vatMinor, currency),
      grossAmount: fromMinor(lineTotal.grossMinor, currency),
    };
  });

  return {
    documentId: document.id,
    typeId,
    number,
    issueDate: toDateOnly(data.issueDate),
    currency,
    seller: toDeclaredParty(seller),
    buyer: toDeclaredParty(buyer),
    lines,
    netTotal: fromMinor(totals.netMinor, currency),
    vatTotal: fromMinor(totals.vatMinor, currency),
    grossTotal: fromMinor(totals.grossMinor, currency),
  };
}
