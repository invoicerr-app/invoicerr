import { CountryComplianceProfile } from '../schema';

/**
 * The fail-safe profile (COMPLIANCE_ARCHITECTURE.md §4 principle #8, §16.13).
 * Used for any country we have no profile for, or no rule for the date. It produces a conservative,
 * explicitly-flagged output (plain PDF + EN-16931 attachment, post-audit, no clearance, no tax
 * claimed) and carries `confidence = FALLBACK` so the caller is told the result is unverified —
 * we are never silently non-compliant.
 */
export const FALLBACK: CountryComplianceProfile = {
  countryCode: 'XX',
  displayName: 'Unknown / unsupported jurisdiction',
  schemaVersion: '1.0',
  confidence: 'FALLBACK',

  regime: [{ validFrom: '1900-01-01', value: { model: 'POST_AUDIT', blocking: false } }],

  formats: [
    {
      validFrom: '1900-01-01',
      value: { primary: { syntax: 'PLAIN_PDF' }, human: { syntax: 'EN16931_UBL' }, buyerNegotiable: true },
    },
  ],

  transmission: [{ validFrom: '1900-01-01', value: { channels: [{ type: 'EMAIL' }] } }],

  // We do not know the local tax system → claim no tax and let confidence/warnings flag it.
  taxSystem: { kind: 'NONE' },

  lifecycle: [
    {
      validFrom: '1900-01-01',
      value: {
        immutableAfter: 'NEVER',
        correctionModel: 'CREDIT_NOTE',
        cancellation: { allowed: true, requiresAuthorityAck: false },
      },
    },
  ],

  archival: [
    { validFrom: '1900-01-01', value: { retentionYears: 10, archivedForm: 'HYBRID_PDF', integrity: 'NONE' } },
  ],

  reporting: [],
  requiredIdentifiers: [],

  numbering: [{ validFrom: '1900-01-01', value: { model: 'GAPLESS_SELF' } }],
};
