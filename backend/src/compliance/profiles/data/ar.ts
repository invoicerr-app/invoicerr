/**
 * Argentina (AR) — Latin America.
 * F-9: requalified from AUTHORITY_RANGE — AFIP does not pre-allocate a folio range; the issuer
 * self-numbers sequentially (queries FECompUltimoAutorizado for the last authorized number and
 * increments) and only receives the CAE (Código de Autorización Electrónico) authorization
 * a posteriori, at transmit time (see afip-transmission.ts). That CAE is modeled as an
 * authorityId on the transmission result, independent of numbering — only the numbering model
 * was wrong. GAPLESS_SELF is the `clearance()` archetype default, so no override is needed here.
 * ARCA/AFIP, CAE a posteriori
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const AR: CountryComplianceProfile = clearance('AR', 'Argentina', {
  syntax: 'AR_FE',
  providerId: 'afip',
  tax: vat(21, [10.5, 27]),
});
