/**
 * Paraguay — SIFEN — Latin America.
 *
 * Portal id `sifen`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const SIFEN_PORTAL: GenericPortalSpec = {
  id: 'sifen',
  label: 'Paraguay SIFEN e-Kuatia',
  artifact: 'PY_DE',
  baseUrls: {
    test: 'https://sifen.set.gov.py/de/ws/async/de/recibe',
    prod: 'https://sifen.set.gov.py/de/ws/sync/de/recibe',
  },
  authHint: 'PKCS#12 certificate from ANDE-accredited CA',
  submitEndpoint: '',
  pollEndpoint: '/consulta',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'SIFEN environment',
      required: true,
      options: [
        { label: 'Test (async)', value: 'test' },
        { label: 'Producción (sync)', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'ruc', label: 'RUC (xxx-x format)', required: true },
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
