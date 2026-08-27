/**
 * Croatia e-Račun — Europe (national, non-EN/Peppol).
 *
 * Stub for the `HR_ERACUN` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const HR_ERACUN_FORMAT: NationalFormatSpec = {
  id: 'hr-eracun',
  syntax: 'HR_ERACUN',
  label: 'Croatia e-Račun',
  buildHint: 'build Fiscalization 2.0 e-Račun (EN 16931 / CIUS-HR) for the CIS',
};
