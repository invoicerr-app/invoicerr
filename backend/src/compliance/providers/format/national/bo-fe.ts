/**
 * Bolivia Facturación Electrónica — LATAM.
 *
 * Stub for the `BO_FE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const BO_FE_FORMAT: NationalFormatSpec = {
  id: 'bo-fe',
  syntax: 'BO_FE',
  label: 'Bolivia Facturación Electrónica',
  buildHint: 'build SIN XML + compute CUF/CUFD; sign',
};
