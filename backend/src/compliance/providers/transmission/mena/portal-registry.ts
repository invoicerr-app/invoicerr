/**
 * Middle East & North Africa — national portal registry.
 *
 * One file per country under `portals/`: Jordan, Tunisia. This file only holds the
 * region-wide response heuristics and assembles the specs into providers through the
 * shared generic-portal factory.
 *
 * All live calls are deferred — no public sandbox credentials available.
 */

import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from '../generic-portal';
import { JOFOTARA_PORTAL } from './portals/jo-jofotara';
import { TN_TTN_PORTAL } from './portals/tn-ttn';

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
