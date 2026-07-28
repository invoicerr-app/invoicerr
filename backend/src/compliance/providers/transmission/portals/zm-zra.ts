/**
 * Zambia — ZRA Smart Invoice — Sub-Saharan Africa.
 *
 * Portal id `zm-zra`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const ZM_ZRA_PORTAL: GenericPortalSpec = {
  id: 'zm-zra',
  label: 'Zambia ZRA Smart Invoice',
  artifact: 'ZM_SMARTINVOICE',
  baseUrls: {
    test: 'https://smartinvoice-test.zra.org.zm/vsdc/api',
    prod: 'https://smartinvoice.zra.org.zm/vsdc/api',
  },
  authHint: 'ZRA Smart Invoice TPIN + device serial (Virtual Sales Data Controller)',
  submitEndpoint: '/saveinvoice',
  pollEndpoint: '/querySavedInvoice',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'ZRA Smart Invoice environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'tpin', label: 'TPIN (Zambia Tax Payer ID, 10 digits)', required: true },
    { type: 'text', name: 'deviceSerial', label: 'VSDC Device Serial Number', required: true },
    { type: 'text', name: 'apiToken', label: 'Smart Invoice API token', required: true, secret: true },
  ],
  isAsync: false, // ZRA Smart Invoice is real-time
};
