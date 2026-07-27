/**
 * Montenegro fiscalization — Europe (national, non-EN/Peppol).
 *
 * Stub for the `ME_FISCAL` syntax: the engine picks a provider by syntax alone, so
 * implementing this country means filling the build/validate hints below with real bytes.
 */
import { NationalFormatSpec } from '../national-format-spec';

export const ME_FISCAL_FORMAT: NationalFormatSpec = {
  id: 'me-fiscal',
  syntax: 'ME_FISCAL',
  label: 'Montenegro fiscalization',
  buildHint: 'build fiscalization XML (IKOF/JIKR) + QR',
};
