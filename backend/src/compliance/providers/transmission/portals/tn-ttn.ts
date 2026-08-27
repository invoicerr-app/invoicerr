/**
 * Tunisia — TTN El Fatoora (TEIF via TradeNet) — Middle East & North Africa.
 *
 * Portal id `tn-ttn`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const TN_TTN_PORTAL: GenericPortalSpec = {
  id: 'tn-ttn',
  label: 'Tunisia TTN El Fatoora (TEIF)',
  artifact: 'TN_TEIF',
  baseUrls: {
    test: 'https://elfattoura-test.tradenet.com.tn/api/v1',
    prod: 'https://elfattoura.tradenet.com.tn/api/v1',
  },
  authHint: 'TradeNet (TTN) subscriber credentials — MF (matricule fiscal) + API key from TTN subscription',
  submitEndpoint: '/factures/soumettre',
  pollEndpoint: '/factures/statut',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'TTN environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'matriculeFiscal', label: 'Matricule Fiscal (MF)', required: true },
    { type: 'text', name: 'ttnSubscriberId', label: 'TTN Subscriber ID', required: true },
    { type: 'text', name: 'apiToken', label: 'TTN El Fatoora API key', required: true, secret: true },
  ],
  isAsync: true, // El Fatoora has async clearance flow
};
