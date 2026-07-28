/**
 * Dominican Republic e-CF — LATAM.
 *
 * Stub for the `DO_ECF` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const DO_ECF_FORMAT: NationalFormatSpec = {
  id: 'do-ecf',
  syntax: 'DO_ECF',
  label: 'Dominican Republic e-CF',
  buildHint: 'build DGII e-CF XML (e-NCF) + sign',
};
