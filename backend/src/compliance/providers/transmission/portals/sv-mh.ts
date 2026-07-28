/**
 * El Salvador — Ministerio de Hacienda DTE — Latin America.
 *
 * Portal id `sv-mh`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const SV_MH_PORTAL: GenericPortalSpec = {
  id: 'sv-mh',
  label: 'El Salvador Ministerio de Hacienda DTE',
  artifact: 'SV_DTE',
  baseUrls: {
    test: 'https://apitest.dtes.mh.gob.sv/fesv/recepciondte',
    prod: 'https://api.dtes.mh.gob.sv/fesv/recepciondte',
  },
  authHint: 'NIT + password (FESV portal login) → Bearer token via /seguridad/auth',
  submitEndpoint: '',
  pollEndpoint: '/consultaDte',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'MH environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Producción', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'nit', label: 'NIT (xxxx-xxxxxx-xxx-x)', required: true },
    {
      type: 'text',
      name: 'apiToken',
      label: 'Bearer token (from FESV /seguridad/auth)',
      required: true,
      secret: true,
    },
  ],
};
