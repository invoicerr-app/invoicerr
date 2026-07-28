/**
 * Rwanda EBM — Sub-Saharan Africa (fiscal-device real-time).
 *
 * Stub for the `RW_EBM` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const RW_EBM_FORMAT: NationalFormatSpec = {
  id: 'rw-ebm',
  syntax: 'RW_EBM',
  label: 'Rwanda EBM',
  buildHint: 'build RRA EBM payload; device signature',
};
