/**
 * The EN 16931 UBL 2.1 format provider — see `cii-provider.ts`'s own header for the sibling this
 * mirrors, and `format-registry.spec.ts`'s header for what stays out of this ticket's scope.
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from './format-provider';
import { buildEuInvoiceForDocument, newEuInvoiceService } from './shared-build';
import { validateStructural } from './structural-check';
import { EN16931_UBL_SCH, validateSchematron } from './vendored/validate-schematron';

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): Promise<DocumentFormatBuildResult> {
  const euInvoice = buildEuInvoiceForDocument(descriptor, document, company, client);

  const service = newEuInvoiceService();
  // UBL needs no post-processing — the multi-note packing `splitCiiIncludedNotes` fixes is a CII-only
  // defect of the generator (UBL keeps `cbc:Note` as a genuine repeatable element).
  const xml = (await service.generate(euInvoice, { format: 'UBL', lang: 'en' })) as string;

  const structural = validateStructural(xml, 'ubl');
  if (!structural.valid) {
    return { bytes: new TextEncoder().encode(xml), validation: { valid: false, errors: structural.errors } };
  }

  const schematron = validateSchematron(xml, EN16931_UBL_SCH);
  return {
    bytes: new TextEncoder().encode(xml),
    validation: {
      valid: schematron.valid,
      errors: schematron.errors.map((e) => `${e.id}: ${e.message}`),
    },
  };
}

export const ublFormatProvider: DocumentFormatProvider = {
  id: 'ubl',
  syntax: 'EN16931_UBL',
  mime: 'application/xml',
  build,
};
