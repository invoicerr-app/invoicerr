import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { SemanticPartyInput } from './semantic/build-semantic-invoice';

/** What a caller building a normalized export snapshot hands a provider for one party — the same
 *  shape `build-semantic-invoice.ts`'s own bridge consumes, so a provider never has to know whether
 *  it came from `Company` or `Client` (documents.service.ts's own adapter does that mapping once). */
export type DocumentFormatParty = SemanticPartyInput;

export interface DocumentFormatBuildResult {
  bytes: Uint8Array;
  /** Human-facing outcome of the validation GATE — `valid: false` means
   *  `bytes` must NEVER be served; every string in `errors` cites the rule that failed (BR-* for
   *  Schematron, a plain description for the structural pre-check — see `structural-check.ts`). */
  validation: { valid: boolean; errors: string[] };
}

/**
 * What a THIRD PARTY implements to add a normalized document syntax — the exact same registration
 * shape `transports/transport-registry.ts`'s `DocumentTransport` already established for transports:
 * a provider declares `id` (what `format-registry.ts` keys it by, and what the `download-xml`
 * action's own `syntax` param value names — e.g. "cii"), `syntax` (the EN 16931 syntax family this
 * produces, for a human-facing label), and `mime`. `build` is where the descriptor → semantic model
 * bridge (`semantic/build-semantic-invoice.ts`) and the validation GATE (structural + Schematron —
 * `structural-check.ts` + `vendored/validate-schematron.ts`) are composed for ONE document instance;
 * see `cii-provider.ts`/`ubl-provider.ts` for the only two implementations today.
 *
 * `build` NEVER throws for an invalid document — an invalid EN 16931 artifact is still a legitimate,
 * expected OUTCOME (a seller with no VAT identifier on file, for instance — see
 * `semantic/build-semantic-invoice.ts`'s own header on BR-S-02/BR-Z-02), reported through
 * `validation.valid: false`, exactly the way a document TYPE'S OWN `validateAgainstDescriptor`
 * reports a bad field value rather than throwing. It DOES throw `SemanticBuildError`
 * (`semantic/build-semantic-invoice.ts`) for the narrower case where the bridge itself cannot even
 * ATTEMPT to build a document (an unresolvable BT-151) — the caller
 * (`documents.service.ts#downloadDocumentFormat`) turns either outcome into the SAME 400.
 */
export interface DocumentFormatProvider {
  readonly id: string;
  readonly syntax: string;
  readonly mime: string;
  build(
    descriptor: DocumentTypeDescriptor,
    document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
    company: DocumentFormatParty,
    client: DocumentFormatParty,
    /**
     * The owning company's id — OPTIONAL, and unused by `cii-provider.ts`/`ubl-provider.ts` (both
     * already have everything they need in `company`/`client`). Added for `facturx-provider.ts`
     * alone: embedding a Factur-X PDF reuses the SAME human-readable PDF a company downloads
     * (`rendering/render-instance-pdf.ts#renderDocumentInstance`), which needs a company id to
     * resolve reference labels and re-read a couple of presentation-only fields — see that
     * provider's own header for why this is a 5th, optional parameter here rather than a second,
     * differently-shaped interface.
     */
    companyId?: string,
    /** Issue #472 - see `DocumentFormatBuildOptions`. Absent for every invoice build (every transport,
     *  every pre-existing caller), which is therefore byte-for-byte what it was before. */
    options?: DocumentFormatBuildOptions,
  ): Promise<DocumentFormatBuildResult>;
}

/**
 * The invoice this credit note corrects - BG-3 (Preceding invoice reference) in EN 16931, BT-25 its
 * number and BT-26 its issue date; `DatiFattureCollegate` in FatturaPA. Both values are the corrected
 * invoice's OWN legal facts, read from its record (`credit-note-source.ts`), never re-typed.
 */
export interface CorrectedInvoiceReference {
  displayNumber: string;
  /** "yyyy-mm-dd" - the same date-only shape `shared-build.ts#toDateOnly` produces for BT-2. */
  issueDate: string;
}

/**
 * Issue #472 - what turns an otherwise ordinary build into a CREDIT NOTE build. A provider that does
 * not know what to do with `creditNote` must REFUSE rather than silently emit an invoice for it (a
 * credit note served as a type-380 invoice would ADD the amount to what the buyer owes, the exact
 * opposite of the document's meaning) - `fa3-provider.ts` is the one provider that refuses, for the
 * sourced reason its own header gives.
 *
 * `humanReadable` exists for `facturx-provider.ts` alone: a credit note's pricing is built from the
 * INVOICE's own descriptor and lines (`credit-note-source.ts`'s own header on why), but the PDF a
 * Factur-X file embeds must be the credit note AS ISSUED - its own descriptor, its own title, its own
 * number - never an "Invoice" rendering of the corrected lines.
 */
export interface DocumentFormatBuildOptions {
  creditNote?: { correctedInvoice: CorrectedInvoiceReference };
  humanReadable?: {
    descriptor: DocumentTypeDescriptor;
    document: DocumentInstanceResult;
  };
}
