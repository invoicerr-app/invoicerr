/**
 * El Salvador DTE (JSON) — LATAM.
 *
 * Stub for the `SV_DTE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const SV_DTE_FORMAT: NationalFormatSpec = {
  id: 'sv-dte',
  syntax: 'SV_DTE',
  label: 'El Salvador DTE (JSON)',
  buildHint: 'build MH DTE JSON (códigoGeneración, numeroControl, selloRecibido); sign',
};
