/**
 * Ukraine tax-invoice — Europe (national, non-EN/Peppol).
 *
 * Stub for the `UA_TAXINVOICE` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const UA_TAXINVOICE_FORMAT: NationalFormatSpec = {
  id: 'ua-taxinvoice',
  syntax: 'UA_TAXINVOICE',
  label: 'Ukraine tax-invoice',
  buildHint: 'build DPS tax-invoice XML for ЄРПН registration; qualified signature',
};
