/**
 * Dominican Republic — DGII — Latin America.
 *
 * Portal id `dgii`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const DGII_PORTAL: GenericPortalSpec = {
  id: 'dgii',
  label: 'Dominican Republic DGII e-CF',
  artifact: 'DO_ECF',
  baseUrls: {
    test: 'https://ecf.dgii.gov.do/testecf/emisorreceptor',
    prod: 'https://ecf.dgii.gov.do/ecf/emisorreceptor',
  },
  authHint: 'PKCS#12 certificate from DGII-approved CA',
  submitEndpoint: '/send',
  pollEndpoint: '/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'DGII environment',
      required: true,
      options: [
        { label: 'Test (testecf)', value: 'test' },
        { label: 'Producción', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'rnc', label: 'RNC (9 digits)', required: true },
    {
      type: 'text',
      name: 'certBase64',
      label: 'Certificate PKCS#12 (base64)',
      required: false,
      secret: true,
    },
    { type: 'text', name: 'certPassword', label: 'Certificate password', required: false, secret: true },
  ],
};
