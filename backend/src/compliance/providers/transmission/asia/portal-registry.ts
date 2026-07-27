/**
 * Asia-Pacific — national portal registry.
 *
 * One file per country under `portals/`: Taiwan, Kazakhstan, Philippines, Thailand,
 * Nepal, Bangladesh, Pakistan, China, Vietnam. This file only holds the region-wide
 * response heuristics and assembles the specs into providers through the shared generic-
 * portal factory.
 *
 * All live calls are deferred — no public sandbox credentials available.
 */

import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from '../generic-portal';
import { TW_MOF_PORTAL } from './portals/tw-mof';
import { KZ_ISESF_PORTAL } from './portals/kz-isesf';
import { PH_BIR_PORTAL } from './portals/ph-bir';
import { TH_RD_PORTAL } from './portals/th-rd';
import { NP_IRD_PORTAL } from './portals/np-ird';
import { BD_NBR_PORTAL } from './portals/bd-nbr';
import { PK_FBR_PORTAL } from './portals/pk-fbr';
import { CN_STA_PORTAL } from './portals/cn-sta';
import { VN_GDT_PORTAL } from './portals/vn-gdt';

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
