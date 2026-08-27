/**
 * Ecuador comprobantes electrónicos — LATAM.
 *
 * Stub for the `EC_FE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const EC_FE_FORMAT: NationalFormatSpec = {
  id: 'ec-fe',
  syntax: 'EC_FE',
  label: 'Ecuador comprobantes electrónicos',
  buildHint: 'build SRI comprobante XML + clave de acceso (49 dígitos); sign',
};
