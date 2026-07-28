/**
 * Zimbabwe — ZIMRA FDMS (Fiscal Day Management System) — Sub-Saharan Africa.
 *
 * Portal id `zw-zimra`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const ZW_ZIMRA_PORTAL: GenericPortalSpec = {
  id: 'zw-zimra',
  label: 'Zimbabwe ZIMRA FDMS (Fiscal Day Management System)',
  artifact: 'ZW_FDMS',
  baseUrls: {
    test: 'https://fdmsapitest.zimra.co.zw/api/v1',
    prod: 'https://fdmsapi.zimra.co.zw/api/v1',
  },
  authHint: 'ZIMRA FDMS device serial + BPNO (Business Partner Number) from ZIMRA portal',
  submitEndpoint: '/submitDocument',
  pollEndpoint: '/getDocumentStatus',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'ZIMRA FDMS environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'bpno', label: 'BPNO (Business Partner Number)', required: true },
    { type: 'text', name: 'deviceSerial', label: 'Fiscal Device Serial Number', required: true },
    { type: 'text', name: 'apiToken', label: 'FDMS API token', required: true, secret: true },
  ],
  isAsync: false, // FDMS is real-time
};
