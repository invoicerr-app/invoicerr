/**
 * Côte d'Ivoire — DGI FNE (Facture Normalisée Electronique) — Sub-Saharan Africa.
 *
 * Portal id `ci-dgi`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const CI_DGI_PORTAL: GenericPortalSpec = {
  id: 'ci-dgi',
  label: "Côte d'Ivoire DGI FNE (Facture Normalisée Electronique)",
  artifact: 'CI_FNE',
  baseUrls: {
    // FNE is part of the SIGF platform (integrated public finance management system)
    test: 'https://sigf-test.dgi.gouv.ci/fne/api/v1',
    prod: 'https://sigf.dgi.gouv.ci/fne/api/v1',
  },
  authHint: 'DGI FNE API key + NCC (Numéro de Compte Contribuable) from DGI registration',
  submitEndpoint: '/factures/soumettre',
  pollEndpoint: '/factures/statut',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'DGI FNE environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'ncc', label: 'NCC (Numéro de Compte Contribuable)', required: true },
    { type: 'text', name: 'apiToken', label: 'DGI FNE API key', required: true, secret: true },
  ],
  isAsync: false, // FNE is real-time
};
