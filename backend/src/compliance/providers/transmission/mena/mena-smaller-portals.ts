/**
 * MENA smaller portal specs — pure data, built via the shared generic-portal factory.
 *
 * Countries: JO (Jordan — JoFotara), TN (Tunisia — TTN El Fatoora).
 *
 * TR (Turkey GİB) and EG (Egypt ETA) have deeper dedicated clients
 * (gib-transmission.ts / eg-eta-transmission.ts) due to complexity.
 *
 * All live calls are deferred — no public sandbox credentials available.
 * Ref format: "{companyId}|{submissionId}"
 */

import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from '../generic-portal';

export const MENA_PORTAL_HEURISTICS: PortalResponseHeuristics = {
  idFields: ['id', 'uuid', 'submissionId', 'invoiceId', 'referenceNumber', 'receiptNo'],
  statusFields: ['status', 'invoiceStatus', 'result'],
  statusFallback: 'PENDING',
  clearTokens: ['APPROVED', 'CLEARED', 'ACCEPTED', 'VALID', 'SUCCESS', 'CONFIRMED', 'REGISTERED'],
  rejectTokens: ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'DENIED'],
};

export const SMALL_MENA_PORTAL_SPECS: GenericPortalSpec[] = [
  // --- Jordan — JoFotara (ISTD national platform, UBL-based) ---
  {
    id: 'jofotara',
    label: 'Jordan JoFotara (ISTD)',
    artifact: 'JO_JOFOTARA',
    baseUrls: {
      test: 'https://jofotara-test.istd.gov.jo/api/v1',
      prod: 'https://jofotara.istd.gov.jo/api/v1',
    },
    authHint: 'ISTD JoFotara merchant credentials (TIN + API key from ISTD merchant portal)',
    submitEndpoint: '/invoices/submit',
    pollEndpoint: '/invoices/status',
    configFields: [
      {
        type: 'select',
        name: 'environment',
        label: 'JoFotara environment',
        required: true,
        options: [
          { label: 'Test', value: 'test' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'test',
      },
      {
        type: 'text',
        name: 'tin',
        label: 'Jordan TIN (10 digits)',
        required: true,
        minLength: 10,
        maxLength: 10,
      },
      { type: 'text', name: 'merchantId', label: 'JoFotara Merchant ID', required: true },
      { type: 'text', name: 'apiToken', label: 'JoFotara API key', required: true, secret: true },
    ],
    isAsync: true, // JoFotara uses async clearance flow
  },
  // --- Tunisia — TTN El Fatoora (TEIF via TradeNet) ---
  {
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
  },
];

// Static list for registry use (no credentials needed at the stub layer)
export const SMALL_MENA_PROVIDERS = buildGenericPortalProviders(
  SMALL_MENA_PORTAL_SPECS,
  MENA_PORTAL_HEURISTICS,
);
