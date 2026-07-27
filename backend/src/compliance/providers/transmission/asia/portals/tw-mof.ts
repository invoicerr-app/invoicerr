/**
 * Taiwan — MoF eGUI / unified invoice (統一發票) — Asia-Pacific.
 *
 * Portal id `tw-mof`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../../generic-portal';

export const TW_MOF_PORTAL: GenericPortalSpec = {
  id: 'tw-mof',
  label: 'Taiwan MoF eGUI (統一發票)',
  artifact: 'TW_EGUI',
  baseUrls: {
    test: 'https://wwwtest.einvoice.nat.gov.tw/BIZAPIVAN',
    prod: 'https://www.einvoice.nat.gov.tw/BIZAPIVAN',
  },
  authHint: 'MoF APP ID + API Key (申請加值服務介接)',
  submitEndpoint: '/invapp/InvApp',
  pollEndpoint: '/invapp/InvAppQuery',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'MoF environment',
      required: true,
      options: [
        { label: 'Test (wwwtest)', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'appId', label: 'MoF APP ID', required: true },
    { type: 'text', name: 'apiToken', label: 'MoF API Key', required: true, secret: true },
    { type: 'text', name: 'taxId', label: 'Seller Tax ID (統一編號, 8 digits)', required: true },
  ],
  isAsync: true,
};
