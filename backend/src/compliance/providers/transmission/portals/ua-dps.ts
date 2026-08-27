/**
 * Ukraine — DPS ЄРПН (VAT invoice registration) — Europe.
 *
 * Portal id `ua-dps`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const UA_DPS_PORTAL: GenericPortalSpec = {
  id: 'ua-dps',
  label: 'Ukraine DPS ЄРПН (Electronic VAT Invoice Register)',
  artifact: 'UA_TAXINVOICE',
  baseUrls: {
    test: 'https://cabinet.tax.gov.ua/api/test/v1',
    prod: 'https://cabinet.tax.gov.ua/api/v1',
  },
  authHint: 'DPS qualified e-signature (КЕП) via КНЕДП provider; IPN (ЄДРПОУ/ІПН) required',
  submitEndpoint: '/documents/submit',
  pollEndpoint: '/documents/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'DPS environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'ipn', label: 'IPN / ЄДРПОУ (8-10 digits)', required: true },
    { type: 'text', name: 'apiToken', label: 'DPS API token (КЕП session)', required: true, secret: true },
  ],
  isAsync: true, // ЄРПН has async blocking/unblocking flow
};
