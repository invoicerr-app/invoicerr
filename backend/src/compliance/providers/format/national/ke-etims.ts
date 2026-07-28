/**
 * Kenya eTIMS — Sub-Saharan Africa (fiscal-device real-time).
 *
 * Stub for the `KE_ETIMS` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const KE_ETIMS_FORMAT: NationalFormatSpec = {
  id: 'ke-etims',
  syntax: 'KE_ETIMS',
  label: 'Kenya eTIMS',
  buildHint: 'build KRA eTIMS payload (OSCU/VSCU); device signature + QR',
};
