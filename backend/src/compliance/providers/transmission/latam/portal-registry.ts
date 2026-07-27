/**
 * Latin America — national portal registry.
 *
 * One file per country under `portals/`: Costa Rica, Dominican Republic, Guatemala,
 * Panama, Paraguay, El Salvador, Venezuela, Bolivia. This file only holds the region-wide
 * response heuristics and assembles the specs into providers through the shared generic-
 * portal factory.
 *
 * All live calls are deferred — no public sandbox credentials available.
 */

import { GenericPortalSpec, PortalResponseHeuristics, buildGenericPortalProviders } from '../generic-portal';
import { CR_HACIENDA_PORTAL } from './portals/cr-hacienda';
import { DGII_PORTAL } from './portals/do-dgii';
import { GT_SAT_PORTAL } from './portals/gt-sat';
import { PA_DGI_PORTAL } from './portals/pa-dgi';
import { SIFEN_PORTAL } from './portals/py-sifen';
import { SV_MH_PORTAL } from './portals/sv-mh';
import { SENIAT_PORTAL } from './portals/ve-seniat';
import { BO_SIN_PORTAL } from './portals/bo-sin';

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
