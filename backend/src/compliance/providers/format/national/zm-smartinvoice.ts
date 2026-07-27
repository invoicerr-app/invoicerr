/**
 * Zambia Smart Invoice — Sub-Saharan Africa (fiscal-device real-time).
 *
 * Stub for the `ZM_SMARTINVOICE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const ZM_SMARTINVOICE_FORMAT: NationalFormatSpec = {
  id: 'zm-smartinvoice',
  syntax: 'ZM_SMARTINVOICE',
  label: 'Zambia Smart Invoice',
  buildHint: 'build ZRA Smart Invoice payload; device signature',
};
