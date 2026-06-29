/**
 * Port (interface) for remote identifier existence checks.
 *
 * Two real implementations:
 *   - ViesExistenceClient  — EU VIES REST API for VAT existence checks
 *   - SireneExistenceClient — INSEE SIRENE REST API for SIRET existence (FR)
 *
 * Default: NullIdentifierExistenceClient — returns exists: null (unchecked) for
 * every call, so nothing breaks without network / without credentials.
 *
 * Cache note: results should be memoised by the caller; these clients make one
 * HTTP request per call with no internal cache.
 *
 * References:
 *   VIES REST  : https://ec.europa.eu/taxation_customs/vies/#/vat-validation
 *   SIRENE V3  : https://api.insee.fr/catalogue/site/themes/wso2/subthemes/insee/pages/item-info.jag?name=Sirene&version=V3
 */

export interface ExistenceCheckResult {
  scheme: string;
  value: string;
  /** true = found in registry · false = not found · null = could not determine */
  exists: boolean | null;
  source: 'vies' | 'sirene' | 'null';
  /** Set on network error, timeout, or unexpected HTTP status. */
  error?: string;
}

export interface IdentifierExistencePort {
  /** Query the EU VIES service for a VAT number (must include 2-char country prefix, e.g. FR40303265045). */
  checkVat(vatNumber: string): Promise<ExistenceCheckResult>;
  /** Query the INSEE SIRENE API for a SIRET (14 digits). */
  checkSiret(siret: string): Promise<ExistenceCheckResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Null implementation — safe offline default
// ─────────────────────────────────────────────────────────────────────────────

export class NullIdentifierExistenceClient implements IdentifierExistencePort {
  async checkVat(vatNumber: string): Promise<ExistenceCheckResult> {
    return { scheme: 'VAT', value: vatNumber, exists: null, source: 'null' };
  }
  async checkSiret(siret: string): Promise<ExistenceCheckResult> {
    return { scheme: 'SIRET', value: siret, exists: null, source: 'null' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VIES EU VAT existence client (real HTTP)
// Endpoint: GET https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{country}/vat/{vat}
// The API is public and does not require credentials.
// ─────────────────────────────────────────────────────────────────────────────

const VIES_BASE = 'https://ec.europa.eu/taxation_customs/vies/rest-api/ms';

export class ViesExistenceClient implements IdentifierExistencePort {
  constructor(private readonly timeoutMs = 8000) {}

  async checkVat(vatNumber: string): Promise<ExistenceCheckResult> {
    const clean = vatNumber.replace(/[\s-]/g, '').toUpperCase();
    if (clean.length < 4) {
      return { scheme: 'VAT', value: vatNumber, exists: null, source: 'vies', error: 'VAT number too short (need country prefix + digits)' };
    }
    const country = clean.slice(0, 2);
    const vat = clean.slice(2);
    const url = `${VIES_BASE}/${country}/vat/${vat}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        return { scheme: 'VAT', value: vatNumber, exists: null, source: 'vies', error: `HTTP ${res.status} ${res.statusText}` };
      }
      // Response shape: { "isValid": true|false, "userError": "VALID"|... }
      const data = await res.json() as Record<string, unknown>;
      const exists = typeof data['isValid'] === 'boolean' ? data['isValid'] : null;
      return { scheme: 'VAT', value: vatNumber, exists, source: 'vies' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { scheme: 'VAT', value: vatNumber, exists: null, source: 'vies', error: msg };
    }
  }

  /** VIES does not provide SIRET lookup; always returns error. */
  async checkSiret(siret: string): Promise<ExistenceCheckResult> {
    return { scheme: 'SIRET', value: siret, exists: null, source: 'vies', error: 'Use SireneExistenceClient for SIRET lookups' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INSEE SIRENE V3 REST client (real HTTP, requires API key)
// Endpoint: GET https://api.insee.fr/entreprises/sirene/V3/siret/{siret}
// API key obtained from: https://api.insee.fr/catalogue/
// ─────────────────────────────────────────────────────────────────────────────

const SIRENE_SIRET_URL = 'https://api.insee.fr/entreprises/sirene/V3/siret';

export class SireneExistenceClient implements IdentifierExistencePort {
  /**
   * @param apiKey  Bearer token from the INSEE API portal.
   * @param timeoutMs  Per-request timeout (default 8 s).
   */
  constructor(private readonly apiKey: string, private readonly timeoutMs = 8000) {}

  /** SIRENE does not provide VAT lookup; always returns error. */
  async checkVat(vatNumber: string): Promise<ExistenceCheckResult> {
    return { scheme: 'VAT', value: vatNumber, exists: null, source: 'sirene', error: 'Use ViesExistenceClient for VAT lookups' };
  }

  async checkSiret(siret: string): Promise<ExistenceCheckResult> {
    const clean = siret.replace(/[\s-]/g, '');
    if (!/^\d{14}$/.test(clean)) {
      return { scheme: 'SIRET', value: siret, exists: null, source: 'sirene', error: 'SIRET must be 14 digits' };
    }
    const url = `${SIRENE_SIRET_URL}/${clean}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await fetch(url, {
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: 'application/json',
          },
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 404) {
        return { scheme: 'SIRET', value: siret, exists: false, source: 'sirene' };
      }
      if (!res.ok) {
        return { scheme: 'SIRET', value: siret, exists: null, source: 'sirene', error: `HTTP ${res.status} ${res.statusText}` };
      }
      // 200 = establishment found
      return { scheme: 'SIRET', value: siret, exists: true, source: 'sirene' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { scheme: 'SIRET', value: siret, exists: null, source: 'sirene', error: msg };
    }
  }
}

/** Default: offline-safe, never throws. Replace with real clients where live checks are needed. */
export const defaultExistenceClient: IdentifierExistencePort = new NullIdentifierExistenceClient();
