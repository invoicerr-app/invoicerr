/**
 * Montenegro — PU Fiscalization (real-time IKOF/JIKR) — Europe.
 *
 * Portal id `me-fiscal`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const ME_FISCAL_PORTAL: GenericPortalSpec = {
  id: 'me-fiscal',
  label: 'Montenegro Porezna Uprava Fiscalization',
  artifact: 'ME_FISCAL',
  baseUrls: {
    test: 'https://efi-test.tax.gov.me/api/v1',
    prod: 'https://efi.tax.gov.me/api/v1',
  },
  authHint: 'PU fiscalization certificate (TCR code + RSA key pair from Porezna Uprava)',
  submitEndpoint: '/fiscalize/invoice',
  pollEndpoint: '/fiscalize/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'PU environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    {
      type: 'text',
      name: 'pib',
      label: 'PIB (8 digits, tax identification number)',
      required: true,
      minLength: 8,
      maxLength: 8,
    },
    { type: 'text', name: 'tcrCode', label: 'TCR (Tax Cash Register) code', required: true },
    { type: 'text', name: 'apiToken', label: 'PU API token', required: true, secret: true },
  ],
  isAsync: false, // Montenegrin fiscalization is real-time (IKOF → JIKR)
};
