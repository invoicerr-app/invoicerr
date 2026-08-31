/**
 * Factur-X (EN 16931 CII embedded in a PDF/A-3) — root TODO item 12's own documented remainder,
 * RESOLVED: `TODO_ISSUES.md` used to carry an entry titled "Factur-X : embarqueur existant au repère,
 * NON repris" explaining exactly this reuse; that entry is now struck through there (item 10, wave
 * 1) and this file is the promised follow-through, not a new design.
 *
 * The recipe, verbatim from that entry: `buildEuInvoiceForDocument` (shared with `cii-provider.ts`/
 * `ubl-provider.ts`) produces the SAME semantic `EuInvoice`; `@e-invoice-eu/core` (already a
 * dependency — no new one added) embeds it into the SAME human-readable PDF a company downloads
 * (`rendering/render-instance-pdf.ts`) via `service.generate(euInvoice, { format:
 * 'Factur-X-EN16931', pdf: {...} })` — a trivial embedder call, no bespoke PDF/A-3 code here.
 *
 * "Never an unvalidated CII embedded": before ever calling the Factur-X embedder, this provider
 * builds the PLAIN CII string the exact same way `cii-provider.ts` does (same post-processing,
 * same structural + Schematron gate) and refuses to proceed to the PDF step at all if THAT gate
 * fails — returning the failing CII bytes/errors instead, exactly `cii-provider.ts`'s own failure
 * shape. The Factur-X embedder call that follows asks `@e-invoice-eu/core` to regenerate CII
 * internally from the SAME `euInvoice` input (there is no API to hand it a pre-built XML string
 * instead — the library takes the semantic model, not text), so the embedded copy is a
 * deterministic function of content already proven valid, MODULO one known, bounded gap: the
 * multi-note packing fix `semantic/cii-post-process.ts#splitCiiIncludedNotes` applies to the string
 * this provider validates but not to the library's own internal regeneration during the embed call.
 * That fix is a no-op whenever there is at most one note — which is all this bridge ever emits today
 * (`shared-build.ts`'s own header) — so the gap is real but unreached, the same documented scope
 * `cii-provider.ts` already carries for the identical reason.
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { renderDocumentInstance } from '../rendering/render-instance-pdf';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from './format-provider';
import { splitCiiIncludedNotes } from './semantic/cii-post-process';
import { buildEuInvoiceForDocument, newEuInvoiceService } from './shared-build';
import { validateStructural } from './structural-check';
import { EN16931_CII_SCH, validateSchematron } from './vendored/validate-schematron';

export interface FacturxProviderDeps {
  referenceRegistry: EntityReferenceRegistry;
}

/**
 * `buildFacturxFormatProvider` is a FACTORY (unlike `ciiFormatProvider`/`ublFormatProvider`, plain
 * objects) because embedding needs the human PDF, which needs `EntityReferenceRegistry` to resolve
 * reference-field labels — the same dependency `transports/email-transport.ts`'s own factory
 * (`buildEmailTransport`) already takes for an identical reason. `documents-core.module.ts`'s
 * `buildFormatProviderRegistry` is the one caller.
 */
export function buildFacturxFormatProvider(deps: FacturxProviderDeps): DocumentFormatProvider {
  async function build(
    descriptor: DocumentTypeDescriptor,
    // Widened past the interface's own `Pick<...>` to also require `createdAt` — allowed by
    // TypeScript's bivariant method-parameter checking (see `format-provider.ts`'s own interface:
    // `build` is declared with method shorthand, not as an arrow-typed property), and always
    // satisfied in practice: `documents.service.ts#downloadDocumentFormat` — the one caller reaching
    // a provider through the registry — always passes a FULL `DocumentInstanceResult`, which has it.
    document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status' | 'createdAt'>,
    company: DocumentFormatParty,
    client: DocumentFormatParty,
    companyId?: string,
  ): Promise<DocumentFormatBuildResult> {
    if (!companyId) {
      // Unreachable through `documents.service.ts` (it always passes its own `companyId` — see
      // this file's header) — never trusted alone, same defensive posture the rest of this module
      // holds for structurally-guaranteed-but-not-type-enforced invariants.
      throw new Error('facturxFormatProvider.build() requires a companyId to render the embedded PDF.');
    }

    const euInvoice = buildEuInvoiceForDocument(descriptor, document, company, client);
    const service = newEuInvoiceService();

    // 1) The SAME CII `cii-provider.ts` produces, gated the SAME way — see this file's own header.
    const rawCii = (await service.generate(euInvoice, { format: 'CII', lang: 'en' })) as string;
    const cii = splitCiiIncludedNotes(rawCii);

    const structural = validateStructural(cii, 'cii');
    if (!structural.valid) {
      return {
        bytes: new TextEncoder().encode(cii),
        validation: { valid: false, errors: structural.errors },
      };
    }

    const schematron = validateSchematron(cii, EN16931_CII_SCH);
    if (!schematron.valid) {
      return {
        bytes: new TextEncoder().encode(cii),
        validation: { valid: false, errors: schematron.errors.map((e) => `${e.id}: ${e.message}`) },
      };
    }

    // 2) ONLY once the CII gate passed: render the SAME human PDF a company downloads, and embed.
    const { pdf } = await renderDocumentInstance(
      { referenceRegistry: deps.referenceRegistry },
      companyId,
      descriptor,
      document,
    );

    const embedded = (await service.generate(euInvoice, {
      format: 'Factur-X-EN16931',
      pdf: {
        buffer: pdf,
        filename: `${document.displayNumber ?? document.id}.pdf`,
        mimetype: 'application/pdf',
      },
      lang: 'en',
    })) as Uint8Array;

    return { bytes: embedded, validation: { valid: true, errors: [] } };
  }

  return { id: 'facturx', syntax: 'FACTURX', mime: 'application/pdf', build };
}
