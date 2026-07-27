/**
 * Croatia — Fiskalizacija 2.0 / e-Račun CIS — Europe.
 *
 * Portal id `hr-fiskalizacija`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const HR_FISKALIZACIJA_PORTAL: GenericPortalSpec = {
  id: 'hr-fiskalizacija',
  label: 'Croatia Fiskalizacija 2.0 / e-Račun (CIS)',
  artifact: 'HR_ERACUN',
  baseUrls: {
    test: 'https://cis-test.porezna-uprava.hr/api/v2',
    prod: 'https://cis.porezna-uprava.hr/api/v2',
  },
  authHint: 'Hrvatska Porezna Uprava CIS — FINA qualified certificate (OIB registration)',
  submitEndpoint: '/eracun/submit',
  pollEndpoint: '/eracun/status',
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
      name: 'oib',
      label: 'OIB (11 digits, personal identification number)',
      required: true,
      minLength: 11,
      maxLength: 11,
    },
    {
      type: 'text',
      name: 'businessPremise',
      label: 'Business premise identifier (prostor)',
      required: true,
    },
    { type: 'text', name: 'apiToken', label: 'CIS API token', required: true, secret: true },
  ],
  isAsync: true, // e-Račun CIS has async acknowledgement (ZKI → JIR)
};
