/**
 * What `cii-provider.ts` and `ubl-provider.ts` share: turning a document instance into the semantic
 * `EuInvoice` object (`semantic/build-semantic-invoice.ts`) is IDENTICAL for both syntaxes — only the
 * actual XML serialization (`@e-invoice-eu/core`'s `format` option) and the CII-only post-processing
 * (`splitCiiIncludedNotes`) differ, which is why each provider stays a thin, separate file rather
 * than one provider branching internally on `syntax` (the same "one file per capability, a registry
 * ties them together" shape `transports/email-transport.ts` already holds for its own single entry).
 */
import { InvoiceService as EuInvoiceService } from '@e-invoice-eu/core';

import { logger } from '@/logger/logger.service';

import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { computeDocumentTotals } from '../totals/compute-totals';
import { DocumentFormatParty } from './format-provider';
import { buildSemanticInvoice, SemanticLineInput } from './semantic/build-semantic-invoice';

/**
 * Logger for `@e-invoice-eu/core`: quiet on narration, loud on the one thing worth knowing — REPRISED
 * from `invoice-rendering.service.ts` at the repère (git tag `avant-refonte-documents`), which found
 * the hard way that the library's OWN thrown exception message is a bare "validation failed" and the
 * actual diagnosis only ever reaches `logger.error`.
 */
export const EU_LOGGER = {
  log: () => {},
  warn: () => {},
  error: (message: unknown) => {
    logger.error('e-invoice library rejected the document', {
      category: 'documents-formats',
      details: { message: typeof message === 'string' ? message : JSON.stringify(message) },
    });
  },
};

export function newEuInvoiceService(): EuInvoiceService {
  return new EuInvoiceService(EU_LOGGER);
}

/**
 * BT-2 needs a DATE-ONLY string ("yyyy-mm-dd") — `@e-invoice-eu/core`'s own internal ajv schema
 * enforces the pattern strictly (`^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$`), found the
 * hard way against a REAL saved document rather than assumed from a hand-built fixture: the
 * descriptor's 'date' field kind (`field-kinds.ts`) stores a full ISO datetime
 * ("2026-05-31T00:00:00.000Z"), not a bare date, so passing `data.issueDate` straight through (as
 * this bridge's own first version did, and as every jest fixture up to that point had already
 * written as a bare date string, hiding the gap) throws a 500 the moment a document saved through
 * the ordinary form is downloaded. `new Date(...).toISOString().slice(0, 10)` normalizes EITHER
 * shape (a bare date parses to midnight UTC the same way) to the pattern the library actually wants.
 * Exported (item 10, wave 2) — the SAME gap exists for any national format's own issue-date field
 * (FA(3)'s `P_1`, FatturaPA's `Data`), so `formats/national/*-provider.ts` reuse this rather than
 * re-deriving it.
 */
export function toDateOnly(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return new Date().toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Extracts the descriptive line facts (`SemanticLineInput`) straight off the invoice descriptor's
 * OWN field names — `description`/`quantity`/`unit`/`unitPrice`, `invoice.descriptor.ts`'s own line
 * shape, PLUS `supplyType` when a country overlay added that subfield (see `extractSupplyType`
 * below — today, only the FR `country-fields/` overlay does). Deliberately hard-coded to THOSE keys
 * rather than re-running `compute-totals.ts`'s own generic array-field detection: this bridge is
 * invoice-specific by construction (EN 16931 is an invoice standard), so naming the fields it reads
 * is honest coupling, not a shortcut around a generic mechanism that exists for a different job
 * (computing totals for ANY document type).
 */
/** A row's raw `supplyType`, resolved to the strict `SupplyType` union or `undefined` for anything
 *  else (unset, or any other string) — never a guess. Fed only by the FR `country-fields/` overlay's
 *  own `lines[].supplyType` today (see `business-process.ts`'s header); a document type/country with
 *  no such subfield leaves every row's `data.lines[i].supplyType` `undefined`, which is exactly the
 *  "nothing declared" case `frenchBusinessProcessCode` already documents as resolving to 'M1'. */
function extractSupplyType(value: unknown): SemanticLineInput['supplyType'] {
  return value === 'GOODS' || value === 'SERVICES' ? value : undefined;
}

function extractLines(data: Record<string, unknown>): SemanticLineInput[] {
  const rows = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : [];
  return rows.map((row) => ({
    description: typeof row.description === 'string' ? row.description : '',
    quantity: typeof row.quantity === 'number' ? row.quantity : 0,
    unit: typeof row.unit === 'string' ? row.unit : '',
    unitPrice: typeof row.unitPrice === 'number' ? row.unitPrice : 0,
    supplyType: extractSupplyType(row.supplyType),
  }));
}

/**
 * Builds the semantic `EuInvoice` for one document instance — descriptor + already-computed totals
 * + party snapshots, composed exactly once here so `cii-provider.ts`/`ubl-provider.ts` never diverge
 * on how a document's data becomes the semantic model. Throws `SemanticBuildError`
 * (`semantic/build-semantic-invoice.ts`) when a line's VAT category cannot be resolved — the caller
 * (`documents.service.ts#downloadDocumentFormat`) is what turns that into a 400.
 */
export function buildEuInvoiceForDocument(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'data' | 'displayNumber'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
) {
  const data = (document.data ?? {}) as Record<string, unknown>;
  const totals = computeDocumentTotals(descriptor, data);
  const lines = extractLines(data);

  return buildSemanticInvoice({
    // `document.displayNumber` is guaranteed non-null here — the caller only reaches a format
    // provider once `documents.service.ts#downloadDocumentFormat`'s own 409 gate (an un-numbered
    // document, still "draft") has already passed.
    displayNumber: document.displayNumber ?? 'DRAFT',
    issueDate: toDateOnly(data.issueDate),
    notes: typeof data.notes === 'string' && data.notes.trim() ? data.notes : undefined,
    seller: company,
    buyer: client,
    lines,
    totals,
  });
}
