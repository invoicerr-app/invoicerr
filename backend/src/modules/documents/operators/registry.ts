import { ALL_OPERATOR_FILES } from './data/all';
import { OperatorFact } from './schema';

/** Same normalization for both sides of a `baseUrl` comparison — trims whitespace, drops a trailing
 *  slash, lowercases (hostnames are not case-sensitive, and a company pasting a URL from a browser's
 *  address bar is not expected to match a data file's own casing byte-for-byte). Deliberately NOT a
 *  full URL parse: an operator's declared host and a company's pasted one are both plain strings here,
 *  and the only two differences worth tolerating are the ones a human is actually likely to introduce. */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * In-memory view of the operator catalogue — read directly at request time, the same "no per-request
 * performance case, no resetAndSeed-style staleness gap" reasoning `channel-policy/registry.ts`'s own
 * header gives for never mirroring this into a database: an operator fact is descriptive, never
 * enforcement-critical the way a channel-policy mandate is, and every process recomputes the identical
 * view from the identical files on every boot.
 */
export class OperatorCatalog {
  private readonly byId: Record<string, OperatorFact>;
  private readonly byLegalChannel: Record<string, OperatorFact[]>;
  private readonly byTransportId: Record<string, OperatorFact[]>;

  constructor(operators: OperatorFact[] = ALL_OPERATOR_FILES) {
    this.byId = {};
    this.byLegalChannel = {};
    this.byTransportId = {};
    for (const operator of operators) {
      this.byId[operator.id] = operator;
      if (!this.byLegalChannel[operator.legalChannel]) {
        this.byLegalChannel[operator.legalChannel] = [];
      }
      this.byLegalChannel[operator.legalChannel].push(operator);
      if (operator.transportId) {
        if (!this.byTransportId[operator.transportId]) {
          this.byTransportId[operator.transportId] = [];
        }
        this.byTransportId[operator.transportId].push(operator);
      }
    }
  }

  /** Every operator this catalogue knows about, in file order (already sorted by id — see
   *  `data/all.ts`'s own header). */
  all(): OperatorFact[] {
    return Object.values(this.byId);
  }

  byOperatorId(id: string): OperatorFact | undefined {
    return this.byId[id];
  }

  /** Every operator implementing a given legal channel — empty (never a guess) for a channel this
   *  catalogue has no entry for, e.g. "sdi-pec" (see `schema.ts`'s own header on why that legal
   *  channel deliberately has no operator) or "peppol" (removed as a product-level channel concept
   *  2026-09-15, see `data/all.ts`'s own header). */
  forLegalChannel(legalChannel: string): OperatorFact[] {
    return this.byLegalChannel[legalChannel] ?? [];
  }

  /** Every operator reachable through a given `transports/transport-registry.ts` id. The ordinary
   *  case is exactly one entry (acube, billit, iopole, invopop, chorus-pro, ksef, sdi all have their
   *  OWN dedicated transport); "pdp" is the one transport id today more than one operator can share
   *  — see `resolveForTransportConfig` below for how a company's own connection disambiguates which. */
  forTransportId(transportId: string): OperatorFact[] {
    return this.byTransportId[transportId] ?? [];
  }

  /**
   * Resolve which OPERATOR a company's own connected channel config maps to — issue #526's "say how
   * a `pdp` account maps to an operator (by baseUrl)". Never a guess:
   *  - a transport with NO catalogued operator returns null (an id this catalogue does not know, e.g.
   *    a custom/uncatalogued transport a third party registered);
   *  - a transport with EXACTLY ONE catalogued operator resolves to it unconditionally — no ambiguity
   *    to resolve, `config` is not even read;
   *  - a transport with MORE than one (today: only "pdp") resolves by comparing the connected
   *    `config.baseUrl` against each candidate's own `baseUrl.sandbox`/`baseUrl.production`
   *    (normalized — see `normalizeUrl` above); no match, or no `baseUrl` in `config` at all, returns
   *    null rather than picking one arbitrarily — an uncatalogued PA baseUrl is an honest "unknown
   *    operator", never misattributed to whichever candidate happens to be listed first.
   */
  resolveForTransportConfig(
    transportId: string,
    config: Record<string, unknown> | undefined,
  ): OperatorFact | null {
    const candidates = this.forTransportId(transportId);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const configuredBaseUrl = typeof config?.baseUrl === 'string' ? config.baseUrl.trim() : '';
    if (!configuredBaseUrl) return null;
    const normalizedConfigured = normalizeUrl(configuredBaseUrl);

    return (
      candidates.find((operator) => {
        const sandbox = operator.baseUrl?.sandbox;
        const production = operator.baseUrl?.production;
        return (
          (sandbox && normalizeUrl(sandbox) === normalizedConfigured) ||
          (production && normalizeUrl(production) === normalizedConfigured)
        );
      }) ?? null
    );
  }
}

export const defaultOperatorCatalog = new OperatorCatalog();
