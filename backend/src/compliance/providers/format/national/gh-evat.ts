/**
 * Ghana E-VAT — Sub-Saharan Africa (fiscal-device real-time).
 *
 * Stub for the `GH_EVAT` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const GH_EVAT_FORMAT: NationalFormatSpec = {
  id: 'gh-evat',
  syntax: 'GH_EVAT',
  label: 'Ghana E-VAT',
  buildHint: 'build GRA E-VAT payload + QR/short-link',
};
