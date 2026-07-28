/**
 * Tanzania — TRA VFD (Virtual Fiscal Device) — Sub-Saharan Africa.
 *
 * Portal id `tz-tra`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const TZ_TRA_PORTAL: GenericPortalSpec = {
  id: 'tz-tra',
  label: 'Tanzania TRA VFD (Virtual Fiscal Device)',
  artifact: 'TZ_VFD',
  baseUrls: {
    test: 'https://vfd.tra.go.tz/api/v1/test',
    prod: 'https://vfd.tra.go.tz/api/v1',
  },
  authHint: 'TRA VFD registration token + GCN (Global Certification Number) from TRA',
  submitEndpoint: '/receipts/submit',
  pollEndpoint: '/receipts/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'TRA VFD environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'gcn', label: 'GCN (Global Certification Number from TRA)', required: true },
    { type: 'text', name: 'tin', label: 'TIN (Tanzania TIN, 9 digits)', required: true },
    { type: 'text', name: 'apiToken', label: 'VFD registration token', required: true, secret: true },
  ],
  isAsync: false, // TRA VFD is real-time
};
