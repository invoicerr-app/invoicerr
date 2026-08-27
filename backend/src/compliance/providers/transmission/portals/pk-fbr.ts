/**
 * Pakistan — FBR XIR (XML Invoice Reporting) — Asia-Pacific.
 *
 * Portal id `pk-fbr`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const PK_FBR_PORTAL: GenericPortalSpec = {
  id: 'pk-fbr',
  label: 'Pakistan FBR XIR',
  artifact: 'PK_FBR',
  baseUrls: {
    test: 'https://esp.fbr.gov.pk/api/v1/test',
    prod: 'https://esp.fbr.gov.pk/api/v1',
  },
  authHint: 'FBR ESP (Electronic Sales & Invoice Portal) STRN + API key',
  submitEndpoint: '/invoices/report',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'FBR environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'FBR ESP API key', required: true, secret: true },
    { type: 'text', name: 'strn', label: 'STRN (Sales Tax Registration Number)', required: true },
  ],
  isAsync: false,
};
