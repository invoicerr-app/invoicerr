/**
 * Albania — CIS Fiscalization — Europe.
 *
 * Portal id `al-cis`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const AL_CIS_PORTAL: GenericPortalSpec = {
  id: 'al-cis',
  label: 'Albania CIS Fiscalization (Tatime)',
  artifact: 'AL_FISCALIZATION',
  baseUrls: {
    test: 'https://efiskalizimi-test.tatime.gov.al/api/v1',
    prod: 'https://efiskalizimi.tatime.gov.al/api/v1',
  },
  authHint: 'Albanian Tatime CIS — NIPT + RSA-2048 certificate from Tatime portal',
  submitEndpoint: '/fiscalize/invoice',
  pollEndpoint: '/fiscalize/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'CIS environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    {
      type: 'text',
      name: 'nipt',
      label: 'NIPT (10 chars, Albanian taxpayer ID)',
      required: true,
      minLength: 10,
      maxLength: 10,
    },
    { type: 'text', name: 'apiToken', label: 'CIS API token', required: true, secret: true },
  ],
  isAsync: true, // Albanian CIS has async NSLF/NIVF flow
};
