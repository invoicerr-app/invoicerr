/**
 * Thailand e-Tax Invoice — Asia.
 *
 * Stub for the `TH_ETAX` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const TH_ETAX_FORMAT: NationalFormatSpec = {
  id: 'th-etax',
  syntax: 'TH_ETAX',
  label: 'Thailand e-Tax Invoice',
  buildHint: 'build RD e-Tax Invoice & e-Receipt XML (PKCS#7 / digital signature)',
};
