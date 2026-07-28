/**
 * Vietnam TT78 e-invoice — Added with the dev docs merge (new clearance majors with a national schema).
 *
 * Stub for the `VN_TT78` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const VN_TT78_FORMAT: NationalFormatSpec = {
  id: 'vn-tt78',
  syntax: 'VN_TT78',
  label: 'Vietnam TT78 e-invoice',
  buildHint: 'build the TT78/Decree-123 e-invoice XML; apply the mandatory digital signature (token/HSM)',
};
