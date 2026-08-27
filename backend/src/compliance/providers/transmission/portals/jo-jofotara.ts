/**
 * Jordan — JoFotara (ISTD national platform, UBL-based) — Middle East & North Africa.
 *
 * Portal id `jofotara`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const JOFOTARA_PORTAL: GenericPortalSpec = {
  id: 'jofotara',
  label: 'Jordan JoFotara (ISTD)',
  artifact: 'JO_JOFOTARA',
  baseUrls: {
    test: 'https://jofotara-test.istd.gov.jo/api/v1',
    prod: 'https://jofotara.istd.gov.jo/api/v1',
  },
  authHint: 'ISTD JoFotara merchant credentials (TIN + API key from ISTD merchant portal)',
  submitEndpoint: '/invoices/submit',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'JoFotara environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    {
      type: 'text',
      name: 'tin',
      label: 'Jordan TIN (10 digits)',
      required: true,
      minLength: 10,
      maxLength: 10,
    },
    { type: 'text', name: 'merchantId', label: 'JoFotara Merchant ID', required: true },
    { type: 'text', name: 'apiToken', label: 'JoFotara API key', required: true, secret: true },
  ],
  isAsync: true, // JoFotara uses async clearance flow
};
