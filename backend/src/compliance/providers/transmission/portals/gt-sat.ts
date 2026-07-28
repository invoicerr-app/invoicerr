/**
 * Guatemala — SAT (via certificador) — Latin America.
 *
 * Portal id `gt-sat`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const GT_SAT_PORTAL: GenericPortalSpec = {
  id: 'gt-sat',
  label: 'Guatemala SAT (FEL via certificador)',
  artifact: 'GT_FEL',
  baseUrls: {
    test: 'https://feltest.sat.gob.gt/dte/v1',
    prod: 'https://fel.sat.gob.gt/dte/v1',
  },
  authHint: 'API key from SAT-authorized certificador (INFILE, G4S, Megaprint)',
  submitEndpoint: '/dte',
  pollEndpoint: '/dte/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'SAT environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Producción', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'Certificador API key', required: true, secret: true },
    { type: 'text', name: 'nit', label: 'NIT (digits only)', required: true },
  ],
};
