import { DocumentTypeDescriptor } from '../documents/descriptors/types';

/**
 * Which document TYPES the client portal ever shows at all, and which FIELD on each one names the
 * billable client. Deliberately hardcoded to these three — the same "this file already names its
 * type, so hardcoding it here costs nothing" reasoning `settlement/credits.ts`'s own header gives for
 * "invoice" being the only correctable type: today, "invoice"/"quote"/"credit-note" are the only
 * descriptors with any `clientVisible` status at all (see each one's own `statuses` array), and a
 * third-party type that wants a portal presence gets one by adding itself here — a one-line change,
 * not a rewrite of this module. This is NOT what `DocumentStatusDescriptor.clientVisible` decides
 * (that flag is about STATUS eligibility, generic across every type it is set on); this is the
 * structural fact of WHICH field, on WHICH type, holds a client reference at all.
 *
 * "credit-note" carries no `client` field of its own (only `invoice` — see credit-note.descriptor.ts's
 * own header) — `clientIdOfCreditNote` resolves it through the invoice being corrected, the exact join
 * `settlement/credits.ts#creditsForInvoiceFromNotes` already performs for the statement.
 */
export const PORTAL_DOCUMENT_TYPE_IDS = ['invoice', 'quote', 'credit-note'] as const;
export type PortalDocumentTypeId = (typeof PORTAL_DOCUMENT_TYPE_IDS)[number];

export function isPortalDocumentType(typeId: string): typeId is PortalDocumentTypeId {
  return (PORTAL_DOCUMENT_TYPE_IDS as readonly string[]).includes(typeId);
}

/**
 * Which `statuses[].id` of `descriptor` a client portal session may ever see — derived from the
 * descriptor's OWN data (`DocumentStatusDescriptor.clientVisible`), never a hardcoded per-type list.
 * A descriptor declaring no `statuses` at all (opts out of the lifecycle model — see
 * `DocumentTypeDescriptor.statuses`'s own header) yields an empty set: nothing of that type is ever
 * portal-visible, the safe default for a type this module was never told about.
 */
export function clientVisibleStatusIds(descriptor: DocumentTypeDescriptor): Set<string> {
  return new Set(
    (descriptor.statuses ?? []).filter((status) => status.clientVisible).map((status) => status.id),
  );
}

/** The `data` key the invoice/quote descriptors give their own client reference field. Exported so a
 *  caller narrowing the QUERY by client (`portal.service.ts#listQuotes`, which pushes the condition
 *  into SQL rather than filtering a capped page in memory) names the same key `directClientId` below
 *  reads — one constant, never two spellings that can drift apart. */
export const DIRECT_CLIENT_FIELD_KEY = 'client';

/** The invoice/quote `client` reference field's own value, read directly off a document's `data` —
 *  `undefined` for a data anomaly (missing/wrong-typed field), never a thrown error: a caller checks
 *  this against a known clientId, and `undefined !== clientId` refuses exactly the way a genuine
 *  mismatch would. */
export function directClientId(data: Record<string, unknown>): string | undefined {
  const value = data[DIRECT_CLIENT_FIELD_KEY];
  return typeof value === 'string' ? value : undefined;
}

/** A credit note's own `invoice` reference field's value — see this file's own header. */
export function invoiceIdOfCreditNote(data: Record<string, unknown>): string | undefined {
  return typeof data.invoice === 'string' ? data.invoice : undefined;
}
