/**
 * Smaller LATAM portal specs — pure data, built via the shared generic-portal factory.
 *
 * Countries: CR (Costa Rica), DO (Dominican Republic), GT (Guatemala),
 *            PA (Panama), PY (Paraguay), SV (El Salvador), VE (Venezuela), BO (Bolivia).
 *
 * All live calls are deferred — no public sandbox credentials available.
 * Ref format (all): "{companyId}|{submissionId}"
 */

import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from '../generic-portal';

/** Spanish-language portal conventions (estado/autorizado/rechazado …). */
export const LATAM_PORTAL_HEURISTICS: PortalResponseHeuristics = {
  idFields: ['id', 'trackId', 'idEnvio', 'numEnvio', 'uuid', 'nRec'],
  statusFields: ['estado', 'status', 'estado_doc'],
  statusFallback: 'EN_PROCESO',
  clearTokens: ['AUTORI', 'CLEARED', 'ACCEPTED', 'ACEPTAD', 'APPROVED', 'APROBAD', 'CONFIRMAD', 'DOK', 'FOK'],
  rejectTokens: ['RECHAZ', 'REJECT', 'REFUSED', 'REFUS', 'DENIED', 'DENEGAD', 'ERREUR', 'NO AUTORI', 'INVALID'],
};

export const SMALL_LATAM_PORTAL_SPECS: GenericPortalSpec[] = [
  // --- Costa Rica — Ministerio de Hacienda ---
  {
    id: 'cr-hacienda',
    label: 'Costa Rica Ministerio de Hacienda',
    artifact: 'CR_FE',
    baseUrls: {
      test: 'https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1',
      prod: 'https://api.comprobanteselectronicos.go.cr/recepcion/v1',
    },
    authHint: 'OAuth2 client_credentials from Hacienda ATV portal',
    submitEndpoint: '/recepcion',
    pollEndpoint: '/comprobante',
    configFields: [
      { type: 'select', name: 'environment', label: 'Hacienda environment', required: true,
        options: [{ label: 'Sandbox (test)', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
      { type: 'text', name: 'apiToken', label: 'OAuth2 Bearer token', required: true, secret: true },
      { type: 'text', name: 'cedula', label: 'Cédula jurídica (10 digits)', required: true },
    ],
  },
  // --- Dominican Republic — DGII ---
  {
    id: 'dgii',
    label: 'Dominican Republic DGII e-CF',
    artifact: 'DO_ECF',
    baseUrls: {
      test: 'https://ecf.dgii.gov.do/testecf/emisorreceptor',
      prod: 'https://ecf.dgii.gov.do/ecf/emisorreceptor',
    },
    authHint: 'PKCS#12 certificate from DGII-approved CA',
    submitEndpoint: '/send',
    pollEndpoint: '/status',
    configFields: [
      { type: 'select', name: 'environment', label: 'DGII environment', required: true,
        options: [{ label: 'Test (testecf)', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
      { type: 'text', name: 'rnc', label: 'RNC (9 digits)', required: true },
      { type: 'text', name: 'certBase64', label: 'Certificate PKCS#12 (base64)', required: false, secret: true },
      { type: 'text', name: 'certPassword', label: 'Certificate password', required: false, secret: true },
    ],
  },
  // --- Guatemala — SAT (via certificador) ---
  {
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
      { type: 'select', name: 'environment', label: 'SAT environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
      { type: 'text', name: 'apiToken', label: 'Certificador API key', required: true, secret: true },
      { type: 'text', name: 'nit', label: 'NIT (digits only)', required: true },
    ],
  },
  // --- Panama — DGI (via PAC/certificador) ---
  {
    id: 'pa-dgi',
    label: 'Panama DGI (FE via PAC)',
    artifact: 'PA_FE',
    baseUrls: {
      test: 'https://sfep-test.mef.gob.pa/api/v1',
      prod: 'https://sfep.mef.gob.pa/api/v1',
    },
    authHint: 'OAuth2 token from DGI/PAC',
    submitEndpoint: '/documentos',
    pollEndpoint: '/documentos',
    configFields: [
      { type: 'select', name: 'environment', label: 'DGI environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
      { type: 'text', name: 'apiToken', label: 'PAC/DGI Bearer token', required: true, secret: true },
      { type: 'text', name: 'ruc', label: 'RUC', required: true },
    ],
  },
  // --- Paraguay — SIFEN ---
  {
    id: 'sifen',
    label: 'Paraguay SIFEN e-Kuatia',
    artifact: 'PY_DE',
    baseUrls: {
      test: 'https://sifen.set.gov.py/de/ws/async/de/recibe',
      prod: 'https://sifen.set.gov.py/de/ws/sync/de/recibe',
    },
    authHint: 'PKCS#12 certificate from ANDE-accredited CA',
    submitEndpoint: '',
    pollEndpoint: '/consulta',
    configFields: [
      { type: 'select', name: 'environment', label: 'SIFEN environment', required: true,
        options: [{ label: 'Test (async)', value: 'test' }, { label: 'Producción (sync)', value: 'prod' }], default: 'test' },
      { type: 'text', name: 'ruc', label: 'RUC (xxx-x format)', required: true },
      { type: 'text', name: 'certBase64', label: 'Certificate PKCS#12 (base64)', required: false, secret: true },
      { type: 'text', name: 'certPassword', label: 'Certificate password', required: false, secret: true },
    ],
  },
  // --- El Salvador — Ministerio de Hacienda DTE ---
  {
    id: 'sv-mh',
    label: 'El Salvador Ministerio de Hacienda DTE',
    artifact: 'SV_DTE',
    baseUrls: {
      test: 'https://apitest.dtes.mh.gob.sv/fesv/recepciondte',
      prod: 'https://api.dtes.mh.gob.sv/fesv/recepciondte',
    },
    authHint: 'NIT + password (FESV portal login) → Bearer token via /seguridad/auth',
    submitEndpoint: '',
    pollEndpoint: '/consultaDte',
    configFields: [
      { type: 'select', name: 'environment', label: 'MH environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
      { type: 'text', name: 'nit', label: 'NIT (xxxx-xxxxxx-xxx-x)', required: true },
      { type: 'text', name: 'apiToken', label: 'Bearer token (from FESV /seguridad/auth)', required: true, secret: true },
    ],
  },
  // --- Venezuela — SENIAT ---
  {
    id: 'seniat',
    label: 'Venezuela SENIAT factura electrónica',
    artifact: 'VE_FE',
    baseUrls: {
      // SENIAT portal endpoints are subject to change; use official SIVEF API
      test: 'https://sivef-test.seniat.gob.ve/fe/v1',
      prod: 'https://sivef.seniat.gob.ve/fe/v1',
    },
    authHint: 'RIF + clave SENIAT (SIVEF portal credentials)',
    submitEndpoint: '/emitir',
    pollEndpoint: '/consultar',
    configFields: [
      { type: 'select', name: 'environment', label: 'SENIAT environment', required: true,
        options: [{ label: 'Test', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
      { type: 'text', name: 'rif', label: 'RIF (J-xxxxxxxx-x)', required: true },
      { type: 'text', name: 'apiToken', label: 'SIVEF Bearer token', required: true, secret: true },
    ],
  },
  // --- Bolivia — SIN (Sistema Integral de Facturación) ---
  {
    id: 'bo-sin',
    label: 'Bolivia SIN facturación electrónica',
    artifact: 'BO_FE',
    baseUrls: {
      test: 'https://pilotosiatv.impuestos.gob.bo/FacturaElectronicaV3',
      prod: 'https://siatv.impuestos.gob.bo/FacturaElectronicaV3',
    },
    authHint: 'NIT + API key from SIN SIAT-V portal',
    submitEndpoint: '/registroComputarizadoCompraVenta',
    pollEndpoint: '/estadoFactura',
    configFields: [
      { type: 'select', name: 'environment', label: 'SIN environment', required: true,
        options: [{ label: 'Piloto (test)', value: 'test' }, { label: 'Producción', value: 'prod' }], default: 'test' },
      { type: 'text', name: 'nit', label: 'NIT (digits only)', required: true },
      { type: 'text', name: 'apiToken', label: 'SIN API token', required: true, secret: true },
    ],
  },
];

// Static list for registry use (no credentials needed at the stub layer)
export const SMALL_LATAM_PROVIDERS = buildGenericPortalProviders(SMALL_LATAM_PORTAL_SPECS, LATAM_PORTAL_HEURISTICS);
