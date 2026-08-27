/**
 * Nigeria FIRS e-invoice — Sub-Saharan Africa (fiscal-device real-time).
 *
 * Stub for the `NG_FIRS` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const NG_FIRS_FORMAT: NationalFormatSpec = {
  id: 'ng-firs',
  syntax: 'NG_FIRS',
  label: 'Nigeria FIRS e-invoice',
  buildHint: 'build FIRS MBS payload + IRN/QR',
};
