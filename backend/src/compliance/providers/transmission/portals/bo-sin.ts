/**
 * Bolivia — SIN (Sistema Integral de Facturación) — Latin America.
 *
 * Portal id `bo-sin`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const BO_SIN_PORTAL: GenericPortalSpec = {
  id: 'bo-sin',
  label: 'Bolivia SIN facturación electrónica',
  artifact: 'BO_FE',
  baseUrls: {
    test: 'https://pilotosiatv.impuestos.gob.bo/FacturaElectronicaV3',
    prod: 'https://siatv.impuestos.gob.bo/FacturaElectronicaV3',
  },
  authHint: 'NIT + API key from SIN SIAT-V portal',
  submitEndpoint: '/registroComputarizadoCompraVenta',
  pollEndpoint: '/estadoFactura',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'SIN environment',
      required: true,
      options: [
        { label: 'Piloto (test)', value: 'test' },
        { label: 'Producción', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'nit', label: 'NIT (digits only)', required: true },
    { type: 'text', name: 'apiToken', label: 'SIN API token', required: true, secret: true },
  ],
};
