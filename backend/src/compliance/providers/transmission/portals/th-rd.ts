/**
 * Thailand — RD e-Tax Invoice & e-Receipt — Asia-Pacific.
 *
 * Portal id `th-rd`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const TH_RD_PORTAL: GenericPortalSpec = {
  id: 'th-rd',
  label: 'Thailand RD e-Tax Invoice',
  artifact: 'TH_ETAX',
  baseUrls: {
    test: 'https://etax-test.rd.go.th/api/v1',
    prod: 'https://etax.rd.go.th/api/v1',
  },
  authHint: 'RD Service Provider API key + digital signature (ETDA-certified)',
  submitEndpoint: '/invoices/submit',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'RD environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'RD Service Provider API key', required: true, secret: true },
    { type: 'text', name: 'tin', label: 'Seller TIN (Thai Tax ID, 13 digits)', required: true },
  ],
  isAsync: false, // Real-time/reporting
};
