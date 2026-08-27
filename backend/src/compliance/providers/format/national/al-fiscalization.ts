/**
 * Albania fiscalization — Europe (national, non-EN/Peppol).
 *
 * Stub for the `AL_FISCALIZATION` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const AL_FISCALIZATION_FORMAT: NationalFormatSpec = {
  id: 'al-fiscalization',
  syntax: 'AL_FISCALIZATION',
  label: 'Albania fiscalization',
  buildHint: 'build CIS fiscalization XML (UBL-based) + NIVF/NSLF + QR',
};
