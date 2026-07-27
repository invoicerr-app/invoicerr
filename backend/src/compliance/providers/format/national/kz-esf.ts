/**
 * Kazakhstan ESF — Asia.
 *
 * Stub for the `KZ_ESF` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const KZ_ESF_FORMAT: NationalFormatSpec = {
  id: 'kz-esf',
  syntax: 'KZ_ESF',
  label: 'Kazakhstan ESF',
  buildHint: 'build IS ESF XML (virtual warehouse linkage); sign',
};
