/**
 * Serbia — SEF (electronic invoicing system) — Europe.
 *
 * Portal id `rs-sef`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const RS_SEF_PORTAL: GenericPortalSpec = {
  id: 'rs-sef',
  label: 'Serbia SEF (Sistem e-Faktura)',
  artifact: 'EN16931_UBL',
  baseUrls: {
    test: 'https://tefportal-test.mfin.gov.rs/api/v1',
    prod: 'https://efaktura.mfin.gov.rs/api/v1',
  },
  authHint: 'SEF portal — PIB (9-digit tax ID) + API key from SEF portal registration',
  submitEndpoint: '/invoices',
  pollEndpoint: '/invoices',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'SEF environment',
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
      label: 'PIB (9-digit tax identification number)',
      required: true,
      minLength: 9,
      maxLength: 9,
    },
    { type: 'text', name: 'apiToken', label: 'SEF API key', required: true, secret: true },
  ],
  isAsync: true, // SEF has async acceptance by buyer flow
};
