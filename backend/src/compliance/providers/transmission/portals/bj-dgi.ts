/**
 * Benin — DGI MECeF / SeMeF (Machine Electronique de Contrôle et de Facturation) — Sub-Saharan Africa.
 *
 * Portal id `bj-dgi`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const BJ_DGI_PORTAL: GenericPortalSpec = {
  id: 'bj-dgi',
  label: 'Benin DGI MECeF / SeMeF',
  artifact: 'BJ_MECEF',
  baseUrls: {
    // SeMeF (Système de Facturation Électronique et Monétique Fiscale)
    test: 'https://semef-test.impots.bj/api/v1',
    prod: 'https://semef.impots.bj/api/v1',
  },
  authHint: 'DGI MECeF IFU (Identifiant Fiscal Unique, 13 digits) + API key from DGI registration',
  submitEndpoint: '/factures/enregistrer',
  pollEndpoint: '/factures/statut',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'DGI MECeF environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    {
      type: 'text',
      name: 'ifu',
      label: 'IFU (Identifiant Fiscal Unique, 13 digits)',
      required: true,
      minLength: 13,
      maxLength: 13,
    },
    { type: 'text', name: 'apiToken', label: 'MECeF/SeMeF API key', required: true, secret: true },
  ],
  isAsync: false, // MECeF is real-time
};
