/**
 * Kazakhstan — IS ESF (Информационная система электронных счетов-фактур) — Asia-Pacific.
 *
 * Portal id `kz-isesf`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const KZ_ISESF_PORTAL: GenericPortalSpec = {
  id: 'kz-isesf',
  label: 'Kazakhstan IS ESF',
  artifact: 'KZ_ESF',
  baseUrls: {
    test: 'https://test.esf.gov.kz:8443/api',
    prod: 'https://esf.gov.kz:8443/api',
  },
  authHint: 'IS ESF login + password + X.509 token (ЭЦП КНЦ / Казахстанский национальный УЦ)',
  submitEndpoint: '/i/create-and-send',
  pollEndpoint: '/i/invoices',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'IS ESF environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    {
      type: 'text',
      name: 'apiToken',
      label: 'IS ESF session token (from X.509 auth)',
      required: true,
      secret: true,
    },
    { type: 'text', name: 'bin', label: 'BIN (Бизнес-идентификационный номер, 12 digits)', required: true },
  ],
  isAsync: true,
};
