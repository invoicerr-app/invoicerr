/**
 * Namespaced env-var helpers for national-portal live tests.
 *
 * Convention
 * ----------
 * For a provider whose `id` is e.g. `choruspro`, `eg-eta`, `in-irp`, `tn-ttn`:
 *   prefix = id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
 *            → CHORUSPRO, EG_ETA, IN_IRP, TN_TTN
 *
 * Each portal self-gates on `<PREFIX>_LIVE=1` and reads its own namespaced creds:
 *   <PREFIX>_BASE_URL        Portal API base URL
 *   <PREFIX>_ENVIRONMENT     TEST | PROD (default: TEST)
 *   <PREFIX>_API_KEY         API key
 *   <PREFIX>_AUTH_TOKEN      Bearer / session token
 *   <PREFIX>_CLIENT_ID       OAuth2 client ID
 *   <PREFIX>_CLIENT_SECRET   OAuth2 client secret
 *   <PREFIX>_CERTIFICATE     PFX certificate, base64-encoded
 *   <PREFIX>_CERT_PASSWORD   Certificate password
 *   <PREFIX>_TAXPAYER_ID     Taxpayer / company identifier on the portal
 *   <PREFIX>_SELLER_VAT      Seller VAT number (fixture)
 *   <PREFIX>_BUYER_VAT       Buyer VAT number (fixture)
 *   <PREFIX>_SELLER_NAME     Seller company name (fixture)
 *   <PREFIX>_BUYER_NAME      Buyer company name (fixture)
 *   <PREFIX>_COUNTRY         Seller country code — 2-letter ISO (fixture)
 *   <PREFIX>_BUYER_COUNTRY   Buyer country code (fixture)
 *   <PREFIX>_CURRENCY        Invoice currency code (fixture, default EUR)
 *   <PREFIX>_XML_PATH        Path to a pre-built XML file (skips auto-generation)
 *   <PREFIX>_SYNTAX          Artifact syntax (default EN16931_UBL)
 *
 * Provider-specific extras (e.g. CHORUSPRO_TECH_LOGIN) can be added per-portal on top.
 *
 * Usage
 * -----
 *   import { portalPrefix, readNamespacedConfig } from './portal-live-env.js';
 *
 *   const prefix  = portalPrefix('eg-eta');          // → 'EG_ETA'
 *   const config  = readNamespacedConfig(prefix);    // strips prefix, camelCases keys
 *   // config.clientId, config.apiKey, config.baseUrl, …
 */

/**
 * Derive the env-var prefix from a provider id.
 * e.g. 'eg-eta' → 'EG_ETA',  'in-irp' → 'IN_IRP',  'choruspro' → 'CHORUSPRO'
 */
export function portalPrefix(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

/**
 * Standard namespaced credential keys (suffix after `<PREFIX>_`).
 * All optional — the presence gate is left to the caller / liveDescribe.
 */
export const NAMESPACED_KEYS = [
  'BASE_URL',
  'ENVIRONMENT',
  'API_KEY',
  'AUTH_TOKEN',
  'CLIENT_ID',
  'CLIENT_SECRET',
  'CERTIFICATE',
  'CERT_PASSWORD',
  'TAXPAYER_ID',
  'SELLER_VAT',
  'BUYER_VAT',
  'SELLER_NAME',
  'BUYER_NAME',
  'COUNTRY',
  'BUYER_COUNTRY',
  'CURRENCY',
  'XML_PATH',
  'SYNTAX',
] as const;

/** Camel-case a screaming-snake suffix: 'CLIENT_ID' → 'clientId'. */
function toCamel(suffix: string): string {
  return suffix
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Build a config object by scanning `env` for every `<PREFIX>_*` key.
 *
 * - Strips the `<PREFIX>_` prefix.
 * - Converts the remaining suffix to camelCase.
 * - Skips the gate key itself (`<PREFIX>_LIVE`).
 * - Includes any extra provider-specific keys (e.g. CHORUSPRO_TECH_LOGIN) automatically.
 */
export function readNamespacedConfig(
  prefix: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const gateKey = `${prefix}_LIVE`;
  for (const [key, val] of Object.entries(env)) {
    if (!key.startsWith(`${prefix}_`)) continue;
    if (key === gateKey) continue;     // skip the gate flag itself
    if (!val) continue;                // skip empty / undefined
    const suffix = key.slice(prefix.length + 1); // strip 'PREFIX_'
    result[toCamel(suffix)] = val;
  }
  return result;
}
