/**
 * Philippines EIS — Asia.
 *
 * Stub for the `PH_EIS` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const PH_EIS_FORMAT: NationalFormatSpec = {
  id: 'ph-eis',
  syntax: 'PH_EIS',
  label: 'Philippines EIS',
  buildHint: 'build BIR EIS JSON; sign',
};
