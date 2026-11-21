/**
 * The EN 16931 UBL 2.1 format provider — see `cii-provider.ts`'s own header for the sibling this
 * mirrors, and `format-registry.spec.ts`'s header for what stays out of scope.
 *
 * Its `build()` is `buildValidatedUbl` (`shared-build.ts`) with no option: the default EN 16931
 * customization ID, no delta Schematron, and no post-processing - the multi-note packing
 * `splitCiiIncludedNotes` fixes is a CII-only defect of the generator (UBL keeps `cbc:Note` as a
 * genuine repeatable element).
 */
import { DocumentFormatProvider } from './format-provider';
import { buildValidatedUbl } from './shared-build';

export const ublFormatProvider: DocumentFormatProvider = {
  id: 'ubl',
  syntax: 'EN16931_UBL',
  mime: 'application/xml',
  build: buildValidatedUbl({}),
};
