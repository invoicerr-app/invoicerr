/**
 * Benin e-MECeF — Sub-Saharan Africa (fiscal-device real-time).
 *
 * Stub for the `BJ_MECEF` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const BJ_MECEF_FORMAT: NationalFormatSpec = {
  id: 'bj-mecef',
  syntax: 'BJ_MECEF',
  label: 'Benin e-MECeF',
  buildHint: 'build DGI e-MECeF payload + MECeF code/QR',
};
