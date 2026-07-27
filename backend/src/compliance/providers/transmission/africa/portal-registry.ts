/**
 * Sub-Saharan Africa — national portal registry.
 *
 * One file per country under `portals/`: Ghana, Rwanda, Tanzania, Uganda, Zambia,
 * Zimbabwe, Côte d'Ivoire, Benin. This file only holds the region-wide response
 * heuristics and assembles the specs into providers through the shared generic-portal
 * factory.
 *
 * All live calls are deferred — no public sandbox credentials available.
 */

import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from '../generic-portal';
import { GH_GRA_PORTAL } from './portals/gh-gra';
import { RW_RRA_PORTAL } from './portals/rw-rra';
import { TZ_TRA_PORTAL } from './portals/tz-tra';
import { UG_URA_PORTAL } from './portals/ug-ura';
import { ZM_ZRA_PORTAL } from './portals/zm-zra';
import { ZW_ZIMRA_PORTAL } from './portals/zw-zimra';
import { CI_DGI_PORTAL } from './portals/ci-dgi';
import { BJ_DGI_PORTAL } from './portals/bj-dgi';

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
