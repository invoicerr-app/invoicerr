/**
 * Bangladesh — NBR e-invoice — Asia-Pacific.
 *
 * Portal id `bd-nbr`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const BD_NBR_PORTAL: GenericPortalSpec = {
  id: 'bd-nbr',
  label: 'Bangladesh NBR e-invoice',
  artifact: 'BD_NBR',
  baseUrls: {
    test: 'https://nbr-test.gov.bd/api/v1',
    prod: 'https://nbr.gov.bd/api/v1',
  },
  authHint: 'NBR e-invoice API key + BIN (Business Identification Number)',
  submitEndpoint: '/invoices',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'NBR environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'NBR API key', required: true, secret: true },
    { type: 'text', name: 'bin', label: 'BIN (9 digits)', required: true },
  ],
  isAsync: false,
};
