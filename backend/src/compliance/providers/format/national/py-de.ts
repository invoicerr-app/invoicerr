/**
 * Paraguay e-Kuatia DE — LATAM.
 *
 * Stub for the `PY_DE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const PY_DE_FORMAT: NationalFormatSpec = {
  id: 'py-de',
  syntax: 'PY_DE',
  label: 'Paraguay e-Kuatia DE',
  buildHint: 'build SIFEN Documento Electrónico (DE) XML + CDC; sign',
};
