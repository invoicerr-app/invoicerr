/**
 * Uganda — URA EFRIS (Electronic Fiscal Receipting and Invoicing System) — Sub-Saharan Africa.
 *
 * Portal id `ug-ura`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const UG_URA_PORTAL: GenericPortalSpec = {
  id: 'ug-ura',
  label: 'Uganda URA EFRIS',
  artifact: 'UG_EFRIS',
  baseUrls: {
    test: 'https://efris-test.ura.go.ug/efrisng/api/v3',
    prod: 'https://efris.ura.go.ug/efrisng/api/v3',
  },
  authHint: 'URA EFRIS device serial + TPIN (Taxpayer Identification Number, 10 digits)',
  submitEndpoint: '/business/saveInvoice',
  pollEndpoint: '/business/searchInvoice',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'URA EFRIS environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'tpin', label: 'TPIN (Uganda TIN, 10 digits)', required: true },
    { type: 'text', name: 'deviceNo', label: 'EFRIS Device Number', required: true },
    { type: 'text', name: 'apiToken', label: 'URA EFRIS API token', required: true, secret: true },
  ],
  isAsync: false, // EFRIS is real-time
};
