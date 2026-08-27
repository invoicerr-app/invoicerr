/**
 * Panama FE/CF — LATAM.
 *
 * Stub for the `PA_FE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const PA_FE_FORMAT: NationalFormatSpec = {
  id: 'pa-fe',
  syntax: 'PA_FE',
  label: 'Panama FE/CF',
  buildHint: 'build DGI Factura Electrónica (FE/CF) XML + CUFE',
};
