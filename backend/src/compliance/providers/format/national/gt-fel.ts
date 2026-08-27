/**
 * Guatemala FEL — LATAM.
 *
 * Stub for the `GT_FEL` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const GT_FEL_FORMAT: NationalFormatSpec = {
  id: 'gt-fel',
  syntax: 'GT_FEL',
  label: 'Guatemala FEL',
  buildHint: 'build SAT FEL DTE XML; sign + certify via certificador',
};
