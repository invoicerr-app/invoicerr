/**
 * Turkey UBL-TR — Added with the dev docs merge (new clearance majors with a national schema).
 *
 * Stub for the `TR_EFATURA` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const TR_EFATURA_FORMAT: NationalFormatSpec = {
  id: 'tr-efatura',
  syntax: 'TR_EFATURA',
  label: 'Turkey UBL-TR',
  buildHint: 'build UBL-TR e-Fatura (registered buyer) or e-Arşiv (unregistered); sign',
};
