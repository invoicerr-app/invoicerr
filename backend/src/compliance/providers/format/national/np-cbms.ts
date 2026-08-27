/**
 * Nepal CBMS — Asia.
 *
 * Stub for the `NP_CBMS` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const NP_CBMS_FORMAT: NationalFormatSpec = {
  id: 'np-cbms',
  syntax: 'NP_CBMS',
  label: 'Nepal CBMS',
  buildHint: 'build IRD CBMS payload (central billing monitoring)',
};
