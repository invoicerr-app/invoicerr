/**
 * Costa Rica Factura Electrónica v4.4 — LATAM.
 *
 * Stub for the `CR_FE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const CR_FE_FORMAT: NationalFormatSpec = {
  id: 'cr-fe',
  syntax: 'CR_FE',
  label: 'Costa Rica Factura Electrónica v4.4',
  buildHint: 'build Hacienda XML v4.4 (clave numérica 50 dígitos) + QR',
};
