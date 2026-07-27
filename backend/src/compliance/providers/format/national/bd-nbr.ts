/**
 * Bangladesh NBR e-invoice — Asia.
 *
 * Stub for the `BD_NBR` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const BD_NBR_FORMAT: NationalFormatSpec = {
  id: 'bd-nbr',
  syntax: 'BD_NBR',
  label: 'Bangladesh NBR e-invoice',
  buildHint: 'build NBR e-invoice payload',
};
