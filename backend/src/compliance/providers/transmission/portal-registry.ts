/**
 * National portal registry — the response heuristics of each authority family, and the
 * assembly of every portal spec into transmission providers.
 *
 * The specs themselves are one file per country under `portals/`; nothing here holds a
 * country's data. The heuristics stay grouped by authority family because that is what
 * they describe: how that family of portals words its status and identifier fields.
 *
 * All live calls are deferred — no public sandbox credentials available.
 */
import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from './generic-portal';
import { AL_CIS_PORTAL } from './portals/al-cis';
import { BD_NBR_PORTAL } from './portals/bd-nbr';
import { BJ_DGI_PORTAL } from './portals/bj-dgi';
import { BO_SIN_PORTAL } from './portals/bo-sin';
import { CI_DGI_PORTAL } from './portals/ci-dgi';
import { CN_STA_PORTAL } from './portals/cn-sta';
import { CR_HACIENDA_PORTAL } from './portals/cr-hacienda';
import { DGII_PORTAL } from './portals/do-dgii';
import { ES_AEAT_PORTAL } from './portals/es-aeat';
import { GH_GRA_PORTAL } from './portals/gh-gra';
import { GR_AADE_PORTAL } from './portals/gr-aade';
import { GT_SAT_PORTAL } from './portals/gt-sat';
import { HR_FISKALIZACIJA_PORTAL } from './portals/hr-fiskalizacija';
import { HU_NAV_PORTAL } from './portals/hu-nav';
import { JOFOTARA_PORTAL } from './portals/jo-jofotara';
import { KZ_ISESF_PORTAL } from './portals/kz-isesf';
import { LV_VID_PORTAL } from './portals/lv-vid';
import { ME_FISCAL_PORTAL } from './portals/me-fiscal';
import { NP_IRD_PORTAL } from './portals/np-ird';
import { PA_DGI_PORTAL } from './portals/pa-dgi';
import { PH_BIR_PORTAL } from './portals/ph-bir';
import { PK_FBR_PORTAL } from './portals/pk-fbr';
import { RS_SEF_PORTAL } from './portals/rs-sef';
import { RW_RRA_PORTAL } from './portals/rw-rra';
import { SENIAT_PORTAL } from './portals/ve-seniat';
import { SIFEN_PORTAL } from './portals/py-sifen';
import { SK_FINANCNASPRAVA_PORTAL } from './portals/sk-financnasprava';
import { SV_MH_PORTAL } from './portals/sv-mh';
import { TH_RD_PORTAL } from './portals/th-rd';
import { TN_TTN_PORTAL } from './portals/tn-ttn';
import { TW_MOF_PORTAL } from './portals/tw-mof';
import { TZ_TRA_PORTAL } from './portals/tz-tra';
import { UA_DPS_PORTAL } from './portals/ua-dps';
import { UG_URA_PORTAL } from './portals/ug-ura';
import { VN_GDT_PORTAL } from './portals/vn-gdt';
import { ZM_ZRA_PORTAL } from './portals/zm-zra';
import { ZW_ZIMRA_PORTAL } from './portals/zw-zimra';

// ─── Sub-Saharan Africa ──────────────────────────────────────────────────────

export const AFRICA_PORTAL_HEURISTICS: PortalResponseHeuristics = {
  idFields: [
    'id',
    'uuid',
    'submissionId',
    'receiptNo',
    'verificationCode',
    'fdnNo',
    'invoiceNo',
    'smartInvoiceNo',
    'mecefCode',
  ],
  statusFields: ['status', 'invoiceStatus', 'approvalStatus', 'result', 'ebmStatus'],
  statusFallback: 'PENDING',
  clearTokens: [
    'APPROVED',
    'CLEARED',
    'VALID',
    'SUCCESS',
    'ACCEPTED',
    'CONFIRMED',
    'REGISTERED',
    'COMPLETED',
    'OK',
    'GENERATED',
    'VERIFIED',
    'SIGNED',
  ],
  rejectTokens: ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'CANCELLED', 'DENIED'],
};

export const SMALL_AFRICA_PORTAL_SPECS: GenericPortalSpec[] = [
  GH_GRA_PORTAL,
  RW_RRA_PORTAL,
  TZ_TRA_PORTAL,
  UG_URA_PORTAL,
  ZM_ZRA_PORTAL,
  ZW_ZIMRA_PORTAL,
  CI_DGI_PORTAL,
  BJ_DGI_PORTAL,
];

// Static list for registry use (no credentials needed at the stub layer)
export const SMALL_AFRICA_PROVIDERS = buildGenericPortalProviders(
  SMALL_AFRICA_PORTAL_SPECS,
  AFRICA_PORTAL_HEURISTICS,
);

// ─── Asia-Pacific ────────────────────────────────────────────────────────────

export const ASIA_PORTAL_HEURISTICS: PortalResponseHeuristics = {
  idFields: ['id', 'uuid', 'submissionId', 'refNo', 'trackId', 'invoiceId', 'receiptNo'],
  statusFields: ['status', 'invoiceStatus', 'approvalStatus', 'documentStatus', 'result'],
  statusFallback: 'PENDING',
  clearTokens: [
    'APPROVED',
    'CLEARED',
    'VALID',
    'SUCCESS',
    'ACCEPTED',
    'AUTHORIZED',
    'REGISTERED',
    'COMPLETED',
    'COMMITTED',
    'OK',
    'PASSED',
    'DELIVERED',
  ],
  rejectTokens: ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'CANCELLED', 'DENIED'],
};

export const SMALL_ASIA_PORTAL_SPECS: GenericPortalSpec[] = [
  TW_MOF_PORTAL,
  KZ_ISESF_PORTAL,
  PH_BIR_PORTAL,
  TH_RD_PORTAL,
  NP_IRD_PORTAL,
  BD_NBR_PORTAL,
  PK_FBR_PORTAL,
  CN_STA_PORTAL,
  VN_GDT_PORTAL,
];

// Static list for registry use (no credentials needed at the stub layer)
export const SMALL_ASIA_PROVIDERS = buildGenericPortalProviders(
  SMALL_ASIA_PORTAL_SPECS,
  ASIA_PORTAL_HEURISTICS,
);

// ─── Europe ──────────────────────────────────────────────────────────────────

export const EUROPE_PORTAL_HEURISTICS: PortalResponseHeuristics = {
  idFields: ['id', 'uuid', 'invoiceId', 'submissionId', 'jir', 'index', 'ref'],
  statusFields: ['status', 'invoiceStatus', 'result'],
  statusFallback: 'PENDING',
  clearTokens: [
    'APPROVED',
    'CLEARED',
    'ACCEPTED',
    'VALID',
    'SUCCESS',
    'CONFIRMED',
    'REGISTERED',
    'SENT',
    'OK',
    'VERIFIED',
  ],
  rejectTokens: ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'DENIED', 'CANCELLED'],
};

export const EUROPE_PORTAL_SPECS: GenericPortalSpec[] = [
  UA_DPS_PORTAL,
  ME_FISCAL_PORTAL,
  HR_FISKALIZACIJA_PORTAL,
  AL_CIS_PORTAL,
  LV_VID_PORTAL,
  SK_FINANCNASPRAVA_PORTAL,
  RS_SEF_PORTAL,
  ES_AEAT_PORTAL,
  GR_AADE_PORTAL,
  HU_NAV_PORTAL,
];

// Static list for registry use (no credentials needed at the stub layer)
export const EUROPE_PORTAL_PROVIDERS = buildGenericPortalProviders(
  EUROPE_PORTAL_SPECS,
  EUROPE_PORTAL_HEURISTICS,
);

// ─── Latin America ───────────────────────────────────────────────────────────

/** Spanish-language portal conventions (estado/autorizado/rechazado …). */
export const LATAM_PORTAL_HEURISTICS: PortalResponseHeuristics = {
  idFields: ['id', 'trackId', 'idEnvio', 'numEnvio', 'uuid', 'nRec'],
  statusFields: ['estado', 'status', 'estado_doc'],
  statusFallback: 'EN_PROCESO',
  clearTokens: ['AUTORI', 'CLEARED', 'ACCEPTED', 'ACEPTAD', 'APPROVED', 'APROBAD', 'CONFIRMAD', 'DOK', 'FOK'],
  rejectTokens: [
    'RECHAZ',
    'REJECT',
    'REFUSED',
    'REFUS',
    'DENIED',
    'DENEGAD',
    'ERREUR',
    'NO AUTORI',
    'INVALID',
  ],
};

export const SMALL_LATAM_PORTAL_SPECS: GenericPortalSpec[] = [
  CR_HACIENDA_PORTAL,
  DGII_PORTAL,
  GT_SAT_PORTAL,
  PA_DGI_PORTAL,
  SIFEN_PORTAL,
  SV_MH_PORTAL,
  SENIAT_PORTAL,
  BO_SIN_PORTAL,
];

// Static list for registry use (no credentials needed at the stub layer)
export const SMALL_LATAM_PROVIDERS = buildGenericPortalProviders(
  SMALL_LATAM_PORTAL_SPECS,
  LATAM_PORTAL_HEURISTICS,
);

// ─── Middle East & North Africa ──────────────────────────────────────────────

export const MENA_PORTAL_HEURISTICS: PortalResponseHeuristics = {
  idFields: ['id', 'uuid', 'submissionId', 'invoiceId', 'referenceNumber', 'receiptNo'],
  statusFields: ['status', 'invoiceStatus', 'result'],
  statusFallback: 'PENDING',
  clearTokens: ['APPROVED', 'CLEARED', 'ACCEPTED', 'VALID', 'SUCCESS', 'CONFIRMED', 'REGISTERED'],
  rejectTokens: ['REJECTED', 'INVALID', 'FAILED', 'ERROR', 'REFUSED', 'DENIED'],
};

export const SMALL_MENA_PORTAL_SPECS: GenericPortalSpec[] = [JOFOTARA_PORTAL, TN_TTN_PORTAL];

// Static list for registry use (no credentials needed at the stub layer)
export const SMALL_MENA_PROVIDERS = buildGenericPortalProviders(
  SMALL_MENA_PORTAL_SPECS,
  MENA_PORTAL_HEURISTICS,
);
