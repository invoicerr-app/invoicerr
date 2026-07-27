/**
 * Chile DTE — LATAM.
 *
 * Stub for the `CL_DTE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const CL_DTE_FORMAT: NationalFormatSpec = {
  id: 'cl-dte',
  syntax: 'CL_DTE',
  label: 'Chile DTE',
  buildHint: 'build SII DTE (TipoDTE 33/34/52/61) consuming a CAF folio; sign',
};
