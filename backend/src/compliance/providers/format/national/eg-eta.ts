/**
 * Egypt ETA e-invoice — Added with the dev docs merge (new clearance majors with a national schema).
 *
 * Stub for the `EG_ETA` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const EG_ETA_FORMAT: NationalFormatSpec = {
  id: 'eg-eta',
  syntax: 'EG_ETA',
  label: 'Egypt ETA e-invoice',
  buildHint: 'build the ETA e-invoice document (signed JSON/XML) + UUID',
};
