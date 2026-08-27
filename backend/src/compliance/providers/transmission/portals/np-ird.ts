/**
 * Nepal — IRD CBMS (Central Billing Monitoring System) — Asia-Pacific.
 *
 * Portal id `np-ird`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const NP_IRD_PORTAL: GenericPortalSpec = {
  id: 'np-ird',
  label: 'Nepal IRD CBMS',
  artifact: 'NP_CBMS',
  baseUrls: {
    test: 'https://cbms-test.ird.gov.np/api/v1',
    prod: 'https://cbms.ird.gov.np/api/v1',
  },
  authHint: 'IRD CBMS fiscal device API key + PAN (Permanent Account Number)',
  submitEndpoint: '/billingDetails',
  pollEndpoint: '/billingDetails/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'IRD environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'IRD CBMS API key', required: true, secret: true },
    { type: 'text', name: 'pan', label: 'PAN (Permanent Account Number, 9 digits)', required: true },
  ],
  isAsync: false,
};
