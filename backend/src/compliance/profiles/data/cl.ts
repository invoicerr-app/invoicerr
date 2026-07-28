/**
 * Chile (CL) — Latin America.
 * AUTHORITY_RANGE is correct here (unlike the AR case above, F-9): SII genuinely pre-allocates a
 * folio range via a CAF (Código de Autorización de Folios) file the issuer requests in advance
 * and then consumes offline, in order — a real range allocation, not a post-hoc authorization.
 * Ley 19.983: buyer has 8 days to accept/reject; silence = acceptance (CL-Chile.md).
 * DTE + CAF, SII
 */
import { clearance, vat } from '../archetypes';
import { CountryComplianceProfile } from '../schema';

export const CL: CountryComplianceProfile = clearance('CL', 'Chile', {
  syntax: 'CL_DTE',
  providerId: 'sii',
  numbering: 'AUTHORITY_RANGE',
  tax: vat(19),
  response: {
    window: { hours: 192 },
    defaultOnSilence: 'ACCEPT',
    statuses: ['acuse de recibo', 'rechazo', 'reclamo'],
  },
});
