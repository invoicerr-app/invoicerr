/**
 * The ONE bridge from a document instance to `DeclaredInvoice` (`declaration-provider.ts`) — deliberately
 * REUSING the exact same building blocks `formats/shared-build.ts#buildEuInvoiceForDocument` already
 * composes for the CII/UBL exports, rather than a second, parallel derivation:
 *
 *  - `totals/compute-totals.ts#computeDocumentTotals` for every arithmetic figure (net/VAT/gross,
 *    per line AND aggregated) — NEVER recomputed here, the task's own hard rule ("mappe depuis
 *    compute-totals/le document, jamais recalculé").
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
    // Guaranteed non-null by the time a report is ever enqueued — `actions/async-send.ts` numbers a
    // document BEFORE the "sent" write this trigger fires on (see `report-on-send.ts`'s own header).
    number: document.displayNumber ?? 'DRAFT',
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
