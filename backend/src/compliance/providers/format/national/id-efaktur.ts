/**
 * Indonesia e-Faktur — Asia.
 *
 * Stub for the `ID_EFAKTUR` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const ID_EFAKTUR_FORMAT: NationalFormatSpec = {
  id: 'id-efaktur',
  syntax: 'ID_EFAKTUR',
  label: 'Indonesia e-Faktur',
  buildHint: 'build DGT e-Faktur / Coretax XML + approval code',
};
