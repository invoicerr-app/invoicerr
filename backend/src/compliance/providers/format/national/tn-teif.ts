/**
 * Tunisia TEIF — MENA.
 *
 * Stub for the `TN_TEIF` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const TN_TEIF_FORMAT: NationalFormatSpec = {
  id: 'tn-teif',
  syntax: 'TN_TEIF',
  label: 'Tunisia TEIF',
  buildHint: 'build TEIF XML for El Fatoura / TTN; sign',
};
