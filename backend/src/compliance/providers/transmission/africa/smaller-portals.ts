/**
 * Smaller Africa portal specs — pure data, built via the shared generic-portal factory.
 *
 * Countries: GH (Ghana), RW (Rwanda), TZ (Tanzania), UG (Uganda),
 *            ZM (Zambia), ZW (Zimbabwe), CI (Côte d'Ivoire), BJ (Benin).
 *
 * All live calls are deferred — no public sandbox credentials available.
 * Ref format (all): "{companyId}|{submissionId}"
 *
 * Most African fiscal systems are real-time (device-driven) → feedback = NONE.
 * Rwanda EBM and Ghana eVAT support async poll → ASYNC_POLL.
 */

import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from '../generic-portal';

export const AFRICA_PORTAL_HEURISTICS: PortalResponseHeuristics = {
  idFields: ['id', 'uuid', 'submissionId', 'receiptNo', 'verificationCode', 'fdnNo', 'invoiceNo',
    'smartInvoiceNo', 'mecefCode'],
  statusFields: ['status', 'invoiceStatus', 'approvalStatus', 'result', 'ebmStatus'],
  statusFallback: 'PENDING',
  clearTokens: ['APPROVED', 'CLEARED', 'VALID', 'SUCCESS', 'ACCEPTED', 'CONFIRMED',
    'REGISTERED', 'COMPLETED', 'OK', 'GENERATED', 'VERIFIED', 'SIGNED'],
  rejectTokens: ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'CANCELLED', 'DENIED'],
};

export const SMALL_AFRICA_PORTAL_SPECS: GenericPortalSpec[] = [
  // --- Ghana — GRA E-VAT ---
  {
    id: 'gh-gra',
    label: 'Ghana GRA E-VAT',
    artifact: 'GH_EVAT',
    baseUrls: {
      test: 'https://efacture-test.gra.gov.gh/api/v1',
      prod: 'https://efacture.gra.gov.gh/api/v1',
    },
    authHint: 'GRA E-VAT API key + taxpayer TIN (Ghana Revenue Authority)',
    submitEndpoint: '/invoices/submit',
    pollEndpoint: '/invoices/status',
    configFields: [
      {
        type: 'select', name: 'environment', label: 'GRA environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
      },
      { type: 'text', name: 'tin', label: 'GRA TIN (Ghana Taxpayer Identification Number)', required: true },
      { type: 'text', name: 'apiToken', label: 'GRA E-VAT API key', required: true, secret: true },
    ],
    isAsync: true, // GRA E-VAT has async clearance flow
  },
  // --- Rwanda — RRA EBM (Electronic Billing Machine) ---
  {
    id: 'rw-rra',
    label: 'Rwanda RRA EBM (Electronic Billing Machine)',
    artifact: 'RW_EBM',
    baseUrls: {
      test: 'https://ebm.rra.gov.rw/api/test/v1',
      prod: 'https://ebm.rra.gov.rw/api/v1',
    },
    authHint: 'RRA EBM device serial + taxpayer TIN (Rwanda Revenue Authority)',
    submitEndpoint: '/invoices/save',
    pollEndpoint: '/invoices/status',
    configFields: [
      {
        type: 'select', name: 'environment', label: 'RRA EBM environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
      },
      { type: 'text', name: 'tin', label: 'RRA TIN (Rwanda TIN, 9 digits)', required: true },
      { type: 'text', name: 'deviceSerial', label: 'EBM Device Serial Number', required: true },
      { type: 'text', name: 'apiToken', label: 'RRA EBM API token', required: true, secret: true },
    ],
    isAsync: true, // EBM has async clearance
  },
  // --- Tanzania — TRA VFD (Virtual Fiscal Device) ---
  {
    id: 'tz-tra',
    label: 'Tanzania TRA VFD (Virtual Fiscal Device)',
    artifact: 'TZ_VFD',
    baseUrls: {
      test: 'https://vfd.tra.go.tz/api/v1/test',
      prod: 'https://vfd.tra.go.tz/api/v1',
    },
    authHint: 'TRA VFD registration token + GCN (Global Certification Number) from TRA',
    submitEndpoint: '/receipts/submit',
    pollEndpoint: '/receipts/status',
    configFields: [
      {
        type: 'select', name: 'environment', label: 'TRA VFD environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
      },
      { type: 'text', name: 'gcn', label: 'GCN (Global Certification Number from TRA)', required: true },
      { type: 'text', name: 'tin', label: 'TIN (Tanzania TIN, 9 digits)', required: true },
      { type: 'text', name: 'apiToken', label: 'VFD registration token', required: true, secret: true },
    ],
    isAsync: false, // TRA VFD is real-time
  },
  // --- Uganda — URA EFRIS (Electronic Fiscal Receipting and Invoicing System) ---
  {
    id: 'ug-ura',
    label: 'Uganda URA EFRIS',
    artifact: 'UG_EFRIS',
    baseUrls: {
      test: 'https://efris-test.ura.go.ug/efrisng/api/v3',
      prod: 'https://efris.ura.go.ug/efrisng/api/v3',
    },
    authHint: 'URA EFRIS device serial + TPIN (Taxpayer Identification Number, 10 digits)',
    submitEndpoint: '/business/saveInvoice',
    pollEndpoint: '/business/searchInvoice',
    configFields: [
      {
        type: 'select', name: 'environment', label: 'URA EFRIS environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
      },
      { type: 'text', name: 'tpin', label: 'TPIN (Uganda TIN, 10 digits)', required: true },
      { type: 'text', name: 'deviceNo', label: 'EFRIS Device Number', required: true },
      { type: 'text', name: 'apiToken', label: 'URA EFRIS API token', required: true, secret: true },
    ],
    isAsync: false, // EFRIS is real-time
  },
  // --- Zambia — ZRA Smart Invoice ---
  {
    id: 'zm-zra',
    label: 'Zambia ZRA Smart Invoice',
    artifact: 'ZM_SMARTINVOICE',
    baseUrls: {
      test: 'https://smartinvoice-test.zra.org.zm/vsdc/api',
      prod: 'https://smartinvoice.zra.org.zm/vsdc/api',
    },
    authHint: 'ZRA Smart Invoice TPIN + device serial (Virtual Sales Data Controller)',
    submitEndpoint: '/saveinvoice',
    pollEndpoint: '/querySavedInvoice',
    configFields: [
      {
        type: 'select', name: 'environment', label: 'ZRA Smart Invoice environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
      },
      { type: 'text', name: 'tpin', label: 'TPIN (Zambia Tax Payer ID, 10 digits)', required: true },
      { type: 'text', name: 'deviceSerial', label: 'VSDC Device Serial Number', required: true },
      { type: 'text', name: 'apiToken', label: 'Smart Invoice API token', required: true, secret: true },
    ],
    isAsync: false, // ZRA Smart Invoice is real-time
  },
  // --- Zimbabwe — ZIMRA FDMS (Fiscal Day Management System) ---
  {
    id: 'zw-zimra',
    label: 'Zimbabwe ZIMRA FDMS (Fiscal Day Management System)',
    artifact: 'ZW_FDMS',
    baseUrls: {
      test: 'https://fdmsapitest.zimra.co.zw/api/v1',
      prod: 'https://fdmsapi.zimra.co.zw/api/v1',
    },
    authHint: 'ZIMRA FDMS device serial + BPNO (Business Partner Number) from ZIMRA portal',
    submitEndpoint: '/submitDocument',
    pollEndpoint: '/getDocumentStatus',
    configFields: [
      {
        type: 'select', name: 'environment', label: 'ZIMRA FDMS environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
      },
      { type: 'text', name: 'bpno', label: 'BPNO (Business Partner Number)', required: true },
      { type: 'text', name: 'deviceSerial', label: 'Fiscal Device Serial Number', required: true },
      { type: 'text', name: 'apiToken', label: 'FDMS API token', required: true, secret: true },
    ],
    isAsync: false, // FDMS is real-time
  },
  // --- Côte d'Ivoire — DGI FNE (Facture Normalisée Electronique) ---
  {
    id: 'ci-dgi',
    label: "Côte d'Ivoire DGI FNE (Facture Normalisée Electronique)",
    artifact: 'CI_FNE',
    baseUrls: {
      // FNE is part of the SIGF (Système Intégré de Gestion des Finances) platform
      test: 'https://sigf-test.dgi.gouv.ci/fne/api/v1',
      prod: 'https://sigf.dgi.gouv.ci/fne/api/v1',
    },
    authHint: 'DGI FNE API key + NCC (Numéro de Compte Contribuable) from DGI registration',
    submitEndpoint: '/factures/soumettre',
    pollEndpoint: '/factures/statut',
    configFields: [
      {
        type: 'select', name: 'environment', label: 'DGI FNE environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
      },
      { type: 'text', name: 'ncc', label: 'NCC (Numéro de Compte Contribuable)', required: true },
      { type: 'text', name: 'apiToken', label: 'DGI FNE API key', required: true, secret: true },
    ],
    isAsync: false, // FNE is real-time
  },
  // --- Benin — DGI MECeF / SeMeF (Machine Electronique de Contrôle et de Facturation) ---
  {
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
        type: 'select', name: 'environment', label: 'DGI MECeF environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Production', value: 'prod' }], default: 'test',
      },
      { type: 'text', name: 'ifu', label: 'IFU (Identifiant Fiscal Unique, 13 digits)', required: true, minLength: 13, maxLength: 13 },
      { type: 'text', name: 'apiToken', label: 'MECeF/SeMeF API key', required: true, secret: true },
    ],
    isAsync: false, // MECeF is real-time
  },
];

// Static list for registry use (no credentials needed at the stub layer)
export const SMALL_AFRICA_PROVIDERS = buildGenericPortalProviders(SMALL_AFRICA_PORTAL_SPECS, AFRICA_PORTAL_HEURISTICS);
