/**
 * Europe — national portal registry.
 *
 * One file per country under `portals/`: Ukraine, Montenegro, Croatia, Albania, Latvia,
 * Slovakia, Serbia, Spain, Greece, Hungary. This file only holds the region-wide response
 * heuristics and assembles the specs into providers through the shared generic-portal
 * factory.
 *
 * All live calls are deferred — no public sandbox credentials available.
 */

import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from '../generic-portal';
import { UA_DPS_PORTAL } from './portals/ua-dps';
import { ME_FISCAL_PORTAL } from './portals/me-fiscal';
import { HR_FISKALIZACIJA_PORTAL } from './portals/hr-fiskalizacija';
import { AL_CIS_PORTAL } from './portals/al-cis';
import { LV_VID_PORTAL } from './portals/lv-vid';
import { SK_FINANCNASPRAVA_PORTAL } from './portals/sk-financnasprava';
import { RS_SEF_PORTAL } from './portals/rs-sef';
import { ES_AEAT_PORTAL } from './portals/es-aeat';
import { GR_AADE_PORTAL } from './portals/gr-aade';
import { HU_NAV_PORTAL } from './portals/hu-nav';

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
