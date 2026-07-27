/**
 * Zimbabwe FDMS — Sub-Saharan Africa (fiscal-device real-time).
 *
 * Stub for the `ZW_FDMS` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const ZW_FDMS_FORMAT: NationalFormatSpec = {
  id: 'zw-fdms',
  syntax: 'ZW_FDMS',
  label: 'Zimbabwe FDMS',
  buildHint: 'build ZIMRA FDMS fiscal payload + verification QR',
};
