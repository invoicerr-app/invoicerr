/**
 * Latvia — VID eAddress (reporting mandate from 2026) — Europe.
 *
 * Portal id `lv-vid`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const LV_VID_PORTAL: GenericPortalSpec = {
  id: 'lv-vid',
  label: 'Latvia VID e-invoice (eAddress / Peppol mandate)',
  artifact: 'EN16931_UBL',
  baseUrls: {
    test: 'https://eds-test.vid.gov.lv/api/v1',
    prod: 'https://eds.vid.gov.lv/api/v1',
  },
  authHint: 'VID EDS portal — PVN (taxpayer registration number) + API key',
  submitEndpoint: '/einvoice/submit',
  pollEndpoint: '/einvoice/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'VID environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'pvnNumber', label: 'PVN registration number', required: true },
    { type: 'text', name: 'apiToken', label: 'VID EDS API key', required: true, secret: true },
  ],
  isAsync: false, // VID is reporting / forwarding — no clearance loop
};
