/**
 * Ghana — GRA E-VAT — Sub-Saharan Africa.
 *
 * Portal id `gh-gra`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const GH_GRA_PORTAL: GenericPortalSpec = {
  id: 'gh-gra',
  label: 'Ghana GRA E-VAT',
  artifact: 'GH_EVAT',
  baseUrls: {
    test: 'https://efacture-test.gra.gov.gh/api/v1',
    prod: 'https://efacture.gra.gov.gh/api/v1',
  },
  authHint: 'GRA E-VAT API key + taxpayer TIN (Ghana Revenue Authority)',
  submitEndpoint: '/invoices/submit',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'GRA environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'tin', label: 'GRA TIN (Ghana Taxpayer Identification Number)', required: true },
    { type: 'text', name: 'apiToken', label: 'GRA E-VAT API key', required: true, secret: true },
  ],
  isAsync: true, // GRA E-VAT has async clearance flow
};
