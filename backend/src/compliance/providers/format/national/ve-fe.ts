/**
 * Venezuela Factura Electrónica — LATAM.
 *
 * Stub for the `VE_FE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const VE_FE_FORMAT: NationalFormatSpec = {
  id: 've-fe',
  syntax: 'VE_FE',
  label: 'Venezuela Factura Electrónica',
  buildHint: 'build SENIAT XML; sign',
};
