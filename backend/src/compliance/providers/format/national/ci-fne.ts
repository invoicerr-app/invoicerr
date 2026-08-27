/**
 * Ivory Coast FNE — Sub-Saharan Africa (fiscal-device real-time).
 *
 * Stub for the `CI_FNE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const CI_FNE_FORMAT: NationalFormatSpec = {
  id: 'ci-fne',
  syntax: 'CI_FNE',
  label: 'Ivory Coast FNE',
  buildHint: 'build DGI FNE (SIGF) normalized e-invoice + sticker/QR',
};
