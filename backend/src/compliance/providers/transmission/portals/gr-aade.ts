/**
 * Greece — AADE myDATA (RTIR — near-real-time reporting) — Europe.
 *
 * Portal id `gr-aade`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const GR_AADE_PORTAL: GenericPortalSpec = {
  id: 'gr-aade',
  label: 'Greece AADE myDATA (RTIR)',
  artifact: 'NATIONAL_XML', // myDATA uses a specific XML format (mydata:InvoicesDoc)
  baseUrls: {
    test: 'https://mydata-preprod.aade.gr/invoices',
    prod: 'https://mydata.aade.gr/invoices',
  },
  authHint: 'AADE myDATA — AFM (9-digit tax number) + Ocp-Apim-Subscription-Key from myDATA portal',
  submitEndpoint: '/SendInvoices',
  pollEndpoint: '/RequestMyIncome',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'AADE myDATA environment',
      required: true,
      options: [
        { label: 'Pre-production', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    {
      type: 'text',
      name: 'afm',
      label: 'AFM (9-digit Greek tax number, no EL prefix)',
      required: true,
      minLength: 9,
      maxLength: 9,
    },
    { type: 'text', name: 'userId', label: 'myDATA user ID', required: true },
    {
      type: 'text',
      name: 'subscriptionKey',
      label: 'Ocp-Apim-Subscription-Key (myDATA portal)',
      required: true,
      secret: true,
    },
  ],
  isAsync: false, // myDATA is RTIR — fire-and-forget (mark set on acceptance)
};
