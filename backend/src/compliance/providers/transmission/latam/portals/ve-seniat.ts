/**
 * Venezuela — SENIAT — Latin America.
 *
 * Portal id `seniat`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const SENIAT_PORTAL: GenericPortalSpec = {
  id: 'seniat',
  label: 'Venezuela SENIAT factura electrónica',
  artifact: 'VE_FE',
  baseUrls: {
    // SENIAT portal endpoints are subject to change; use official SIVEF API
    test: 'https://sivef-test.seniat.gob.ve/fe/v1',
    prod: 'https://sivef.seniat.gob.ve/fe/v1',
  },
  authHint: 'RIF + clave SENIAT (SIVEF portal credentials)',
  submitEndpoint: '/emitir',
  pollEndpoint: '/consultar',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'SENIAT environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Producción', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'rif', label: 'RIF (J-xxxxxxxx-x)', required: true },
    { type: 'text', name: 'apiToken', label: 'SIVEF Bearer token', required: true, secret: true },
  ],
};
