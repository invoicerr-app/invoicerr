/**
 * Hungary — NAV Online Számla v3 (RTIR) — Europe.
 *
 * Portal id `hu-nav`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const HU_NAV_PORTAL: GenericPortalSpec = {
  id: 'hu-nav',
  label: 'Hungary NAV Online Számla v3 (RTIR)',
  artifact: 'NATIONAL_XML',
  baseUrls: {
    test: 'https://api-test.onlineszamla.nav.gov.hu/invoiceService/v3',
    prod: 'https://api.onlineszamla.nav.gov.hu/invoiceService/v3',
  },
  authHint: 'NAV Online Számla v3 — adószám (8-digit tax number) + API user/key from onlineszamla.nav.gov.hu',
  submitEndpoint: '/manageInvoice',
  pollEndpoint: '/queryInvoiceStatus',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'NAV environment',
      required: true,
      options: [
        { label: 'Test (sandbox)', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    {
      type: 'text',
      name: 'adoszam',
      label: 'Adószám (8-digit Hungarian tax number)',
      required: true,
      minLength: 8,
      maxLength: 13,
    },
    { type: 'text', name: 'login', label: 'NAV Online Számla API login', required: true },
    {
      type: 'text',
      name: 'password',
      label: 'NAV Online Számla API password',
      required: true,
      secret: true,
    },
    {
      type: 'text',
      name: 'xmlSigningKey',
      label: 'XML signing key (signature key from NAV portal)',
      required: true,
      secret: true,
    },
    {
      type: 'text',
      name: 'exchangeKey',
      label: 'Exchange key (data encryption key from NAV portal)',
      required: true,
      secret: true,
    },
  ],
  isAsync: false, // NAV Online Számla is RTIR (real-time incoming reporting)
};
