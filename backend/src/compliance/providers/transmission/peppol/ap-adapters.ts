/**
 * Peppol Access-Point adapter registry — one port, several adapters, per-company choice.
 *
 * The PEPPOL channel keeps a single contract (PeppolApPort: send / getStatus /
 * sendInvoiceResponse) while the per-company channel config selects WHICH corner-2 vendor
 * fulfils it, via the `apProvider` config field (mirrors PDP's `apiStyle` switch):
 *
 *   - 'generic'   (default) — PeppolApHttpClient: the original generic REST gateway model
 *                  (accessPointUrl + apiKey). Backward-compatible: configs without
 *                  `apProvider` keep working unchanged.
 *   - 'peppol-sh' — PeppolShApClient: hosted AP with free unlimited sandbox and
 *                  zero-secret self-signup (see peppol-sh-client.ts). Needs apiKey +
 *                  apCompanyId (their com_… company id).
 *   - 'storecove' — StorecoveApClient: established vendor, raw-UBL submission
 *                  (see storecove-client.ts). Needs apiKey + legalEntityId. Live-deferred.
 *
 * Hosted vendors (peppol-sh, storecove) perform their own SMP/participant resolution at
 * corner 2 — the provider must skip its local SMP pre-check for them
 * (apProviderHandlesRouting).
 */

import { PeppolApHttpClient } from './peppol-client';
import type { PeppolApPort } from './peppol-client';
import { PeppolShApClient } from './peppol-sh-client';
import { StorecoveApClient } from './storecove-client';

export type PeppolApProviderId = 'generic' | 'peppol-sh' | 'storecove';

export const PEPPOL_AP_PROVIDERS: PeppolApProviderId[] = ['generic', 'peppol-sh', 'storecove'];

/** Read + default the apProvider field from a per-company channel config. */
export function apProviderOf(config: Record<string, unknown>): string {
  const raw = config.apProvider;
  return typeof raw === 'string' && raw.length > 0 ? raw : 'generic';
}

/**
 * Whether the selected vendor resolves the receiver itself at corner 2.
 * true → the provider skips its local SMP/SML pre-check (and, for peppol.sh, tolerates a
 * missing buyer peppolId — routing falls back to the tax id inside the document).
 */
export function apProviderHandlesRouting(apProvider: string): boolean {
  return apProvider === 'peppol-sh' || apProvider === 'storecove';
}

/**
 * Per-vendor required config fields. Returns the missing field names ([] = complete).
 * An unknown apProvider is reported as a pseudo-missing field so callers surface a clear
 * SKIPPED note instead of guessing.
 */
export function missingPeppolConfig(config: Record<string, unknown>): string[] {
  const has = (k: string) => {
    const v = config[k];
    return v !== undefined && v !== null && String(v).length > 0;
  };
  switch (apProviderOf(config)) {
    case 'generic':
      return ['participantId', 'accessPointUrl', 'apiKey'].filter((k) => !has(k));
    case 'peppol-sh':
      return ['apiKey', 'apCompanyId'].filter((k) => !has(k));
    case 'storecove':
      return ['apiKey', 'legalEntityId'].filter((k) => !has(k));
    default:
      return [`apProvider (unknown value '${String(config.apProvider)}')`];
  }
}

/**
 * Build the PeppolApPort for a per-company resolved config.
 * Callers must have validated the config first (missingPeppolConfig() === []).
 * Throws on an unknown apProvider — the provider maps that to its error path.
 */
export function resolvePeppolAdapter(config: Record<string, unknown>): PeppolApPort {
  const environment = ((config.environment as string) ?? 'TEST') as 'TEST' | 'PROD';
  const apiKey = config.apiKey as string;
  const apProvider = apProviderOf(config);

  switch (apProvider) {
    case 'generic':
      return new PeppolApHttpClient({
        accessPointUrl: config.accessPointUrl as string,
        apiKey,
        environment,
      });
    case 'peppol-sh':
      return new PeppolShApClient({
        apiKey,
        companyId: config.apCompanyId as string,
        environment,
        // accessPointUrl doubles as an optional base-URL override for hosted vendors.
        ...(config.accessPointUrl ? { baseUrl: config.accessPointUrl as string } : {}),
      });
    case 'storecove':
      return new StorecoveApClient({
        apiKey,
        legalEntityId: Number(config.legalEntityId),
        ...(config.accessPointUrl ? { baseUrl: config.accessPointUrl as string } : {}),
      });
    default:
      throw new Error(`peppol: unknown apProvider '${apProvider}'`);
  }
}
