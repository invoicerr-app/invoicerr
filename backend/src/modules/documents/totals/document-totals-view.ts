import { ConflictException } from '@nestjs/common';

import { DocumentTypeDescriptor } from '../descriptors/types';
import { acceptedOptionTotals, computeQuoteOptionTotals, isQuoteWithOptions } from '../options/quote-options';
import { computeDocumentTotals, DocumentTotals } from './compute-totals';

/** One option's own totals, common lines folded in (`computeQuoteOptionTotals`'s own header). */
export interface DocumentOptionTotalsEntry {
  option: string;
  totals: DocumentTotals;
}

/**
 * What `GET /documents/:id/totals` and the MCP `get_document` tool hand back (issue #487). The
 * ordinary `DocumentTotals` fields, plus two that only a quote with options ever fills:
 *
 *  - `options`: every option's own totals, in the order the company typed them, or null when the
 *    document has fewer than two options (every invoice, every ordinary quote).
 *  - `acceptedOption`: the option whose totals the top-level fields carry, or null.
 *
 * The top level is ONE total or none, never a sum of offers:
 *  - no options: the whole document, exactly as before this field existed;
 *  - options, one accepted (`acceptedOption` names a CURRENT option): that option's totals, the same
 *    figure the list, the header, the portal and the statistics show since #479
 *    (`acceptedOptionTotals`, the one rule for all of them);
 *  - options, none accepted yet, or an `acceptedOption` the quote no longer offers (edited after
 *    acceptance): `netMinor`/`vatMinor`/`grossMinor` are null and `lines`/`vatBreakdown` empty. The
 *    per-option figures are in `options`. This is what the web app already shows for the same quote:
 *    the totals card lists one total per option, the list and the header say "N options" with no
 *    single amount. Null rather than an arbitrary option's figure so that a client reading
 *    `grossMinor` gets nothing instead of a number nobody agreed to.
 */
export interface DocumentTotalsView extends Omit<DocumentTotals, 'netMinor' | 'vatMinor' | 'grossMinor'> {
  netMinor: number | null;
  vatMinor: number | null;
  grossMinor: number | null;
  options: DocumentOptionTotalsEntry[] | null;
  acceptedOption: string | null;
}

/** The single total a document stands for, or null when a quote with options has none yet. See
 *  `DocumentTotalsView`'s own header for the three cases. */
export function resolveSingleTotals(
  typeId: string,
  descriptor: DocumentTypeDescriptor,
  data: Record<string, unknown>,
  acceptedOption: string | null | undefined,
): { totals: DocumentTotals; acceptedOption: string | null } | null {
  if (!isQuoteWithOptions(typeId, data)) {
    return { totals: computeDocumentTotals(descriptor, data), acceptedOption: null };
  }
  const accepted = acceptedOptionTotals(data, acceptedOption);
  return accepted && acceptedOption ? { totals: accepted, acceptedOption } : null;
}

export function resolveDocumentTotalsView(
  typeId: string,
  descriptor: DocumentTypeDescriptor,
  data: Record<string, unknown>,
  acceptedOption: string | null | undefined,
): DocumentTotalsView {
  const perOption = isQuoteWithOptions(typeId, data) ? computeQuoteOptionTotals(data) : null;
  const options = perOption?.map(({ option, totals }) => ({ option, totals })) ?? null;
  const single = resolveSingleTotals(typeId, descriptor, data, acceptedOption);
  if (single) {
    return { ...single.totals, options, acceptedOption: single.acceptedOption };
  }
  return {
    currency: typeof data.currency === 'string' ? data.currency : null,
    lines: [],
    netMinor: null,
    vatMinor: null,
    grossMinor: null,
    vatBreakdown: [],
    warnings: [],
    options,
    acceptedOption: null,
  };
}

/**
 * The totals a SETTLEMENT balance is computed against: a balance needs exactly one gross. A quote
 * with options and no (current) accepted option has none, so this refuses with 409 rather than
 * picking one, the same refusal `resolveInvoiceableLines` applies to converting such a quote.
 * Nothing in the web app asks for a quote's settlement (the section and the badge only render for a
 * type offering "record-payment", which the quote does not), and the MCP tool only asks for an
 * invoice's, so this refusal is only ever met by a direct REST call.
 */
export function resolveSettlementTotals(
  typeId: string,
  descriptor: DocumentTypeDescriptor,
  data: Record<string, unknown>,
  acceptedOption: string | null | undefined,
  label: string,
): DocumentTotals {
  const single = resolveSingleTotals(typeId, descriptor, data, acceptedOption);
  if (!single) {
    throw new ConflictException(
      `Quote "${label}" offers several options and none of its current options is accepted - there ` +
        "is no single total to settle against. GET .../totals gives each option's own figures.",
    );
  }
  return single.totals;
}
