/**
 * China e-Fapiao — Added with the dev docs merge (new clearance majors with a national schema).
 *
 * Stub for the `CN_EFAPIAO` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const CN_EFAPIAO_FORMAT: NationalFormatSpec = {
  id: 'cn-efapiao',
  syntax: 'CN_EFAPIAO',
  label: 'China e-Fapiao',
  buildHint: 'build the fully-digitalized e-Fapiao XML (Golden Tax System IV) — the XML is the legal invoice',
};
