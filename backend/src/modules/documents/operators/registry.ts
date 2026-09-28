import { ALL_OPERATOR_FILES } from './data/all';
import { OperatorFact, OperatorOffering } from './schema';

/** Same normalization for both sides of a `baseUrl` comparison - trims whitespace, drops a trailing
 *  slash, lowercases (hostnames are not case-sensitive, and a company pasting a URL from a browser's
 *  address bar is not expected to match a data file's own casing byte-for-byte). Deliberately NOT a
 *  full URL parse: an offering's declared host and a company's pasted one are both plain strings here,
 *  and the only two differences worth tolerating are the ones a human is actually likely to introduce. */
function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** One operator's SINGLE offering, paired with the operator it belongs to - what every "find by
 *  channel" / "find by transport" lookup below actually returns, since an offering alone (without
 *  knowing which operator it is) answers nothing a caller could act on. */
export interface OperatorOfferingMatch {
  operator: OperatorFact;
  offering: OperatorOffering;
}

/**
 * In-memory view of the operator catalogue - read directly at request time, the same "no per-request
 * performance case, no resetAndSeed-style staleness gap" reasoning `channel-policy/registry.ts`'s own
 * header gives for never mirroring this into a database: an operator fact is descriptive, never
 * enforcement-critical the way a channel-policy mandate is, and every process recomputes the identical
 * view from the identical files on every boot.
 */
export class OperatorCatalog {
  private readonly byId: Record<string, OperatorFact>;
  private readonly offeringsByLegalChannel: Record<string, OperatorOfferingMatch[]>;
  private readonly offeringsByTransportId: Record<string, OperatorOfferingMatch[]>;

  constructor(operators: OperatorFact[] = ALL_OPERATOR_FILES) {
    this.byId = {};
    this.offeringsByLegalChannel = {};
    this.offeringsByTransportId = {};
    for (const operator of operators) {
      this.byId[operator.id] = operator;
      // One operator can carry the SAME transportId on more than one of its OWN offerings (Billit's
      // "pdp" and "peppol" offerings both run through the one wired "billit" transport - see that
      // data file's own notes). That is never a new AMBIGUITY to resolve between two DIFFERENT
      // operators - it is one connection granting more than one simultaneous legal capability - so
      // only the FIRST such offering (file order, deterministic) becomes this transportId's candidate
      // for this operator. Real disambiguation (`resolveForTransportConfig`'s baseUrl match) is
      // reserved for when DISTINCT operators genuinely share a transport id, e.g. a future
      // AFNOR-standard second "pdp" operator.
      const transportIdsClaimedByThisOperator = new Set<string>();
      for (const offering of operator.offerings) {
        const match: OperatorOfferingMatch = { operator, offering };
        if (!this.offeringsByLegalChannel[offering.legalChannel]) {
          this.offeringsByLegalChannel[offering.legalChannel] = [];
        }
        this.offeringsByLegalChannel[offering.legalChannel].push(match);
        if (offering.transportId && !transportIdsClaimedByThisOperator.has(offering.transportId)) {
          transportIdsClaimedByThisOperator.add(offering.transportId);
          if (!this.offeringsByTransportId[offering.transportId]) {
            this.offeringsByTransportId[offering.transportId] = [];
          }
          this.offeringsByTransportId[offering.transportId].push(match);
        }
      }
    }
  }

  /** Every operator this catalogue knows about, each with the FULL set of offerings it declares - in
   *  file order (already sorted by id, see `data/all.ts`'s own header). */
  all(): OperatorFact[] {
    return Object.values(this.byId);
  }

  byOperatorId(id: string): OperatorFact | undefined {
    return this.byId[id];
  }

  /**
   * Every operator implementing a given legal channel - "an operator appears under every channel it
   * offers" (owner review of PR #528): each RETURNED operator's own `offerings` array is trimmed down
   * to just the offering(s) matching THIS channel, never the operator's other, unrelated offerings -
   * a caller asking "who does pdp" never sees A-Cube's "sdi" offering leak into that answer just
   * because A-Cube also does something else. Empty (never a guess) for a channel this catalogue has
   * no offering for at all, e.g. "sdi-pec" (see `schema.ts`'s own header on why that legal channel
   * deliberately has no offering).
   */
  forLegalChannel(legalChannel: string): OperatorFact[] {
    const matches = this.offeringsByLegalChannel[legalChannel] ?? [];
    const byOperatorId = new Map<string, OperatorFact>();
    for (const { operator, offering } of matches) {
      const existing = byOperatorId.get(operator.id);
      if (existing) {
        existing.offerings.push(offering);
      } else {
        byOperatorId.set(operator.id, { ...operator, offerings: [offering] });
      }
    }
    return [...byOperatorId.values()];
  }

  /** Every (operator, offering) pair reachable through a given `transports/transport-registry.ts` id.
   *  The ordinary case is exactly one match (acube's "sdi" offering, billit's "pdp" offering, ...);
   *  "pdp" is the one transport id today more than one offering COULD share - see
   *  `resolveForTransportConfig` below for how a company's own connection disambiguates which. */
  matchesForTransportId(transportId: string): OperatorOfferingMatch[] {
    return this.offeringsByTransportId[transportId] ?? [];
  }

  /**
   * Resolve which OPERATOR (and which of its OFFERINGS) a company's own connected channel config maps
   * to - issue #526's "say how a `pdp` account maps to an operator (by baseUrl)", now answering both
   * "which operator" AND "which offering" (owner review of PR #528: an operator can implement more
   * than one channel, so knowing only the operator is not always enough). Never a guess:
   *  - a transport id with NO catalogued offering returns null (an id this catalogue does not know,
   *    e.g. a custom/uncatalogued transport a third party registered);
   *  - a transport id with EXACTLY ONE catalogued offering resolves to it unconditionally - no
   *    ambiguity to resolve, `config` is not even read;
   *  - a transport id with MORE than one (today: only a hypothetical future second "pdp" offering)
   *    resolves by comparing the connected `config.baseUrl` against each candidate offering's own
   *    `baseUrl.sandbox`/`baseUrl.production` (normalized - see `normalizeUrl` above); no match, or no
   *    `baseUrl` in `config` at all, returns null rather than picking one arbitrarily - an
   *    uncatalogued PA baseUrl is an honest "unknown offering", never misattributed to whichever
   *    candidate happens to be listed first.
   */
  resolveForTransportConfig(
    transportId: string,
    config: Record<string, unknown> | undefined,
  ): OperatorOfferingMatch | null {
    const candidates = this.matchesForTransportId(transportId);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const configuredBaseUrl = typeof config?.baseUrl === 'string' ? config.baseUrl.trim() : '';
    if (!configuredBaseUrl) return null;
    const normalizedConfigured = normalizeUrl(configuredBaseUrl);

    return (
      candidates.find(({ offering }) => {
        const sandbox = offering.baseUrl?.sandbox;
        const production = offering.baseUrl?.production;
        return (
          (sandbox && normalizeUrl(sandbox) === normalizedConfigured) ||
          (production && normalizeUrl(production) === normalizedConfigured)
        );
      }) ?? null
    );
  }
}

export const defaultOperatorCatalog = new OperatorCatalog();
