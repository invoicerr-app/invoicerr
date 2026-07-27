/**
 * Costa Rica — Ministerio de Hacienda — Latin America.
 *
 * Portal id `cr-hacienda`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const CR_HACIENDA_PORTAL: GenericPortalSpec = {
  id: 'cr-hacienda',
  label: 'Costa Rica Ministerio de Hacienda',
  artifact: 'CR_FE',
  baseUrls: {
    test: 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1',
    prod: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1',
  },
  authHint: 'OAuth2 client_credentials from Hacienda ATV portal',
  submitEndpoint: '/recepcion',
  pollEndpoint: '/comprobante',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'Hacienda environment',
      required: true,
      options: [
        { label: 'Sandbox (test)', value: 'test' },
        { label: 'Producción', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'OAuth2 Bearer token', required: true, secret: true },
    { type: 'text', name: 'cedula', label: 'Cédula jurídica (10 digits)', required: true },
  ],
};
