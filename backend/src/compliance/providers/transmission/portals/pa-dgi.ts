/**
 * Panama — DGI (via PAC/certificador) — Latin America.
 *
 * Portal id `pa-dgi`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const PA_DGI_PORTAL: GenericPortalSpec = {
  id: 'pa-dgi',
  label: 'Panama DGI (FE via PAC)',
  artifact: 'PA_FE',
  baseUrls: {
    test: 'https://sfep-test.mef.gob.pa/api/v1',
    prod: 'https://sfep.mef.gob.pa/api/v1',
  },
  authHint: 'OAuth2 token from DGI/PAC',
  submitEndpoint: '/documentos',
  pollEndpoint: '/documentos',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'DGI environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Producción', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'PAC/DGI Bearer token', required: true, secret: true },
    { type: 'text', name: 'ruc', label: 'RUC', required: true },
  ],
};
