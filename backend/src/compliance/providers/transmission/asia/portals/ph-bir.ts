/**
 * Philippines — BIR EIS (Electronic Invoicing System) — Asia-Pacific.
 *
 * Portal id `ph-bir`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const PH_BIR_PORTAL: GenericPortalSpec = {
  id: 'ph-bir',
  label: 'Philippines BIR EIS',
  artifact: 'PH_EIS',
  baseUrls: {
    // BIR EIS sandbox endpoint (Revenue Regulations 8-2022)
    test: 'https://eis-sandbox.bir.gov.ph/api/v1',
    prod: 'https://eis.bir.gov.ph/api/v1',
  },
  authHint: 'BIR EIS Taxpayer ID + API key (Revenue Regulations 8-2022)',
  submitEndpoint: '/invoices',
  pollEndpoint: '/invoices/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'BIR EIS environment',
      required: true,
      options: [
        { label: 'Sandbox', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'BIR EIS API Key', required: true, secret: true },
    { type: 'text', name: 'tin', label: 'Seller TIN (9-12 digits)', required: true },
  ],
  isAsync: false, // BIR EIS is real-time
};
