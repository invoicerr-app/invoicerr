/**
 * Spain — AEAT SII / Verifactu (real-time reporting) — Europe.
 *
 * Portal id `es-aeat`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const ES_AEAT_PORTAL: GenericPortalSpec = {
  id: 'es-aeat',
  label: 'Spain AEAT SII / Verifactu',
  artifact: 'ES_FACTURAE',
  baseUrls: {
    // SII: Web service HTTPS endpoint (SOAP)
    test: 'https://prewww1.aeat.es/wlpl/SSII-FACT/ws/SiiFactB2BV1SOAP',
    prod: 'https://www1.aeat.es/wlpl/SSII-FACT/ws/SiiFactB2BV1SOAP',
  },
  authHint: 'AEAT SII — NIF + qualified certificate (FNMT / AEAT) for SOAP WS auth',
  submitEndpoint: '/submit',
  pollEndpoint: '/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'AEAT environment',
      required: true,
      options: [
        { label: 'Pre-production', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'nif', label: 'NIF (Spanish tax ID, e.g. A12345678)', required: true },
    {
      type: 'text',
      name: 'apiToken',
      label: 'AEAT API token / certificate hash',
      required: true,
      secret: true,
    },
  ],
  isAsync: false, // SII is near-real-time reporting (4 days for B2B)
};
