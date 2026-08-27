/**
 * Pakistan FBR XIR — Asia.
 *
 * Stub for the `PK_FBR` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const PK_FBR_FORMAT: NationalFormatSpec = {
  id: 'pk-fbr',
  syntax: 'PK_FBR',
  label: 'Pakistan FBR XIR',
  buildHint: 'build FBR XIR payload + IRN/QR',
};
