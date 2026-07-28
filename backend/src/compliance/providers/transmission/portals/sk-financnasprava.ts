/**
 * Slovakia — Finančná správa (eInvoice from 2027) — Europe.
 *
 * Portal id `sk-financnasprava`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const SK_FINANCNASPRAVA_PORTAL: GenericPortalSpec = {
  id: 'sk-financnasprava',
  label: 'Slovakia Finančná správa e-invoice',
  artifact: 'EN16931_UBL',
  baseUrls: {
    test: 'https://api-test.financnasprava.sk/einvoice/v1',
    prod: 'https://api.financnasprava.sk/einvoice/v1',
  },
  authHint: 'Finančná správa portal — IČO (8-digit company ID) + API key from e-Dane portal',
  submitEndpoint: '/submit',
  pollEndpoint: '/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'Finančná správa environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    {
      type: 'text',
      name: 'ico',
      label: 'IČO (8-digit company registration number)',
      required: true,
      minLength: 8,
      maxLength: 8,
    },
    { type: 'text', name: 'apiToken', label: 'Finančná správa API key', required: true, secret: true },
  ],
  isAsync: false, // Slovak system is reporting-style (planned 2027)
};
