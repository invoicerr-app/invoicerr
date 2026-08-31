/**
 * The EN 16931 CII (Cross Industry Invoice) format provider — one of exactly two syntaxes this
 * ticket builds (see `format-registry.spec.ts`'s own header for what is deliberately NOT branched
 * here — Factur-X/ZUGFeRD PDF/A-3 embedding, XRechnung, Peppol BIS).
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from './format-provider';
import { splitCiiIncludedNotes } from './semantic/cii-post-process';
import { buildEuInvoiceForDocument, newEuInvoiceService } from './shared-build';
import { validateStructural } from './structural-check';
import { EN16931_CII_SCH, validateSchematron } from './vendored/validate-schematron';

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): Promise<DocumentFormatBuildResult> {
  const euInvoice = buildEuInvoiceForDocument(descriptor, document, company, client);

  const service = newEuInvoiceService();
  const raw = (await service.generate(euInvoice, { format: 'CII', lang: 'en' })) as string;
  // `@e-invoice-eu/core` packs several `cbc:Note` entries into ONE `ram:IncludedNote` holding several
  // `ram:Content` — invalid CII (`Content` occurs at most once per note). See
  // `semantic/cii-post-process.ts`'s own header for the real rejection this fixes. A no-op when
  // there is at most one note (the common case: this bridge emits at most one, from the document's
  // own `notes` field — see `shared-build.ts`), so this is always safe to run.
  const xml = splitCiiIncludedNotes(raw);

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
