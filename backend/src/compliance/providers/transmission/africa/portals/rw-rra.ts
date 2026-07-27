/**
 * Rwanda — RRA EBM (Electronic Billing Machine) — Sub-Saharan Africa.
 *
 * Portal id `rw-rra`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const RW_RRA_PORTAL: GenericPortalSpec = {
  id: 'rw-rra',
  label: 'Rwanda RRA EBM (Electronic Billing Machine)',
  artifact: 'RW_EBM',
  baseUrls: {
    test: 'https://ebm.rra.gov.rw/api/test/v1',
    prod: 'https://ebm.rra.gov.rw/api/v1',
  },
  authHint: 'RRA EBM device serial + taxpayer TIN (Rwanda Revenue Authority)',
  submitEndpoint: '/invoices/save',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'RRA EBM environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'tin', label: 'RRA TIN (Rwanda TIN, 9 digits)', required: true },
    { type: 'text', name: 'deviceSerial', label: 'EBM Device Serial Number', required: true },
    { type: 'text', name: 'apiToken', label: 'RRA EBM API token', required: true, secret: true },
  ],
  isAsync: true, // EBM has async clearance
};
