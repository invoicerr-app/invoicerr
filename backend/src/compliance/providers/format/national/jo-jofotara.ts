/**
 * Jordan JoFotara — MENA.
 *
 * Stub for the `JO_JOFOTARA` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const JO_JOFOTARA_FORMAT: NationalFormatSpec = {
  id: 'jo-jofotara',
  syntax: 'JO_JOFOTARA',
  label: 'Jordan JoFotara',
  buildHint: 'build ISTD JoFotara national e-invoice XML + QR',
};
