/**
 * The EN 16931 CII (Cross Industry Invoice) format provider — one of exactly two syntaxes this
 * ticket builds (see `format-registry.spec.ts`'s own header for what is deliberately NOT branched
 * here — Factur-X/ZUGFeRD PDF/A-3 embedding, XRechnung, Peppol BIS).
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import {
  DocumentFormatBuildOptions,
  DocumentFormatBuildResult,
  DocumentFormatParty,
  DocumentFormatProvider,
} from './format-provider';
import { ciiPostProcessContext, postProcessCii } from './semantic/cii-post-process';
import { buildEuInvoiceForDocument, newEuInvoiceService } from './shared-build';
import { validateStructural } from './structural-check';
import { EN16931_CII_SCH, validateSchematron } from './vendored/validate-schematron';

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
  _companyId?: string,
  options?: DocumentFormatBuildOptions,
): Promise<DocumentFormatBuildResult> {
  const euInvoice = buildEuInvoiceForDocument(descriptor, document, company, client, {
    creditNote: options?.creditNote,
  });
  const service = newEuInvoiceService();
  const raw = (await service.generate(euInvoice, { format: 'CII', lang: 'en' })) as string;
  // `@e-invoice-eu/core` packs several `cbc:Note` entries into ONE `ram:IncludedNote` (invalid CII) and
  // ignores BT-33 on its CII mapping; BT-23 is re-asserted on top. See `semantic/cii-post-process.ts`
  // (`postProcessCii` and the helpers it chains) for each step and the real rejection behind it. Every
  // step is a no-op when nothing applies, so this is always safe to run.
  const xml = postProcessCii(raw, ciiPostProcessContext(euInvoice));

  const structural = validateStructural(xml, 'cii');
  if (!structural.valid) {
    return { bytes: new TextEncoder().encode(xml), validation: { valid: false, errors: structural.errors } };
  }

  const schematron = validateSchematron(xml, EN16931_CII_SCH);
  return {
    bytes: new TextEncoder().encode(xml),
    validation: {
      valid: schematron.valid,
      errors: schematron.errors.map((e) => `${e.id}: ${e.message}`),
    },
  };
}

export const ciiFormatProvider: DocumentFormatProvider = {
  id: 'cii',
  syntax: 'EN16931_CII',
  mime: 'application/xml',
  build,
};
