import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { SemanticPartyInput } from './semantic/build-semantic-invoice';

/** What a caller building a normalized export snapshot hands a provider for one party — the same
 *  shape `build-semantic-invoice.ts`'s own bridge consumes, so a provider never has to know whether
 *  it came from `Company` or `Client` (documents.service.ts's own adapter does that mapping once). */
export type DocumentFormatParty = SemanticPartyInput;

export interface DocumentFormatBuildResult {
  bytes: Uint8Array;
  /** Human-facing outcome of the validation GATE (point 2 of this ticket) — `valid: false` means
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
  ): Promise<DocumentFormatBuildResult>;
}
