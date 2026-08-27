/**
 * Uganda EFRIS — Sub-Saharan Africa (fiscal-device real-time).
 *
 * Stub for the `UG_EFRIS` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const UG_EFRIS_FORMAT: NationalFormatSpec = {
  id: 'ug-efris',
  syntax: 'UG_EFRIS',
  label: 'Uganda EFRIS',
  buildHint: 'build URA EFRIS payload + FDN/QR',
};
