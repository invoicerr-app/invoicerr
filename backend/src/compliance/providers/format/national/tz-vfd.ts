/**
 * Tanzania VFD — Sub-Saharan Africa (fiscal-device real-time).
 *
 * Stub for the `TZ_VFD` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const TZ_VFD_FORMAT: NationalFormatSpec = {
  id: 'tz-vfd',
  syntax: 'TZ_VFD',
  label: 'Tanzania VFD',
  buildHint: 'build TRA VFD payload + verification code/QR',
};
