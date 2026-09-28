import { randomBytes } from 'node:crypto';

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { resolveB2gRoutingRule } from '@/modules/documents/b2g-routing/b2g-routing';
import { resolveCompanyCountryCode } from '@/modules/documents/country-policy/country-policy';
import { PolicyProvenance } from '@/modules/documents/country-policy/schema';
import { activeChannelMandateFor } from '@/modules/documents/transports/channel-policy/mandate';
import { defaultChannelPolicyCatalog } from '@/modules/documents/transports/channel-policy/registry';
import { ChannelPolicyFact, ChannelRequirement } from '@/modules/documents/transports/channel-policy/schema';
import { defaultOperatorCatalog } from '@/modules/documents/operators/registry';
import { defaultReportingObligationCatalog } from '@/modules/documents/reporting/registry';
import { ReportableDocumentType } from '@/modules/documents/reporting/schema';
import { decryptJson, encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';
import { credentialAudit } from '@/utils/credential-access-audit';
import { ChannelEnvironment, CompanyChannelConfig } from '../../../../prisma/generated/prisma/client';

/** What a TRANSPORT (`documents/transports/pdp-transport.ts`) gets back once credentials are
 *  resolved — REPRISED verbatim (shape-for-shape) from `avant-refonte-documents`'s own
 *  `ResolvedChannelConfig`/`ActiveChannelConfig` (channel-credentials-port.ts): `config` is already
 *  DECRYPTED here — a transport is exactly the trusted, server-side caller this whole module exists
 *  to serve; nothing about this type is ever handed back over HTTP (see `ChannelConfigStatus` below
 *  for the ONLY shape a controller response is allowed to carry). */
export interface ResolvedChannelConfig {
  providerId: string;
  channel: string;
  environment: ChannelEnvironment;
  config: Record<string, unknown>;
  isActive: boolean;
}

export interface ActiveChannelConfig extends ResolvedChannelConfig {
  companyId: string;
}

/** What GET returns — status ONLY, never a config value (masked or not). The surest way to honor
 *  that is to never let a secret reach this type's own shape at all, rather than trust a per-field
 *  masking step (the old repo's own `maskSecrets`) to run correctly on every call site forever. See
 *  `channels.service.spec.ts`'s own mutation-proof test. */
export interface ChannelConfigStatus {
  providerId: string;
  channel: string;
  environment: ChannelEnvironment;
  isActive: boolean;
  /** See `CompanyChannelConfig.pushToken`'s own schema comment. Not a secret in the sense `config`
   *  above is — exposing it here is the point: a settings screen needs to show it so the company can
   *  paste it into a callback URL it registers with a foreign authority. `undefined`/`null` for a row
   *  that predates this column, or for a provider whose transport never needed one. */
  pushToken?: string | null;
  /**
   * Issue #526 - which `documents/operators/` catalogue entry this row's `providerId` resolves to,
   * NEVER the connected `baseUrl`/credentials themselves (the "GET never leaks a secret" guarantee
   * this whole interface exists to hold - see `ResolvedOperatorId`'s own reasoning just below
   * `resolveOperatorId`). `null` when this provider has no catalogued operator at all (an
   * uncatalogued transport a third party registered, or - for the "pdp" transport specifically - a
   * connected `baseUrl` this catalogue does not recognize: see
   * `documents/operators/registry.ts#resolveForTransportConfig`'s own header on why that is an
   * honest "unknown", never a guess).
   */
  operatorId?: string | null;
  /**
   * Issue #527 - true when this ACTIVE row would be REFUSED by `invoice-actions.ts`'s own send
   * preflight for a domestic operation, right now: this company's own country currently enforces a
   * DIFFERENT mandated channel (`activeChannelMandateFor`, today's date) and this row's `providerId`
   * is neither that mandate's own `providerId` nor one of its `equivalentProviderIds`. Settings-screen
   * state 4 ("a previously configured channel the send preflight now refuses") reads this rather than
   * recomputing the same comparison itself - see `channels.service.ts#computeBlockedBySend`'s own
   * header for why this never applies `ChannelPolicyFact.scope` narrowing (no invoice, no buyer, the
   * exact same "country-level, not operation-level" honesty `activeChannelMandateFor` itself
   * documents). `undefined` for an inactive row (nothing to warn about - it is not the row a "send"
   * would even consider) or when no mandate currently binds this company's own country at all.
   */
  blockedBySend?: boolean;
}

/**
 * What `GET /api/company/channels`'s own `suggested` array now returns — item 10's original
 * `{ providerId, provenance }` shape, WIDENED (never renamed: `suggestedChannels`/`suggested` stays
 * the settings screen's "what does this country say about each channel" view regardless of whether a
 * given fact happens to be a mere suggestion or a mandate — see `channel-policy/schema.ts`'s own
 * header for why the underlying MODULE was renamed while this controller-facing shape was not: the
 * blast radius of touching every consumer of this exact JSON key was not worth it for a field that is
 * still, honestly, "the country's per-channel stance").
 */
export interface ChannelPolicyStatus {
  providerId: string;
  requirement: ChannelRequirement;
  /** Present only when `requirement === 'mandated'` (schema.ts guarantees it always is, in that case). */
  mandatedFrom?: string;
  /**
   * Present only when `requirement === 'mandated'`: whether TODAY's date already crosses
   * `mandatedFrom` — a DIFFERENT clock than the one `invoice-actions.ts`'s preflight uses (the
   * invoice's own `issueDate`, see `channel-policy/mandate.ts`'s header for why). This settings
   * screen has no document to anchor to, so it can only ever answer the narrower, honestly-labeled
   * question "is this mandate already binding as of right now" — a heads-up for a mandate whose start
   * date is still ahead, never the authority on what a given invoice will actually be allowed to do.
   */
  effectiveNow?: boolean;
  /** Passed through verbatim from `ChannelPolicyFact.equivalentProviderIds` - see that field's own
   *  header. Added for issue #527's "blocked by send" comparison (`blockedBySend` above) so a
   *  frontend never needs its own copy of "is this connected provider equivalent to the mandate". */
  equivalentProviderIds?: string[];
  provenance: PolicyProvenance;
}

/**
 * Issue #527 - one row of the settings screen's LEVEL-1 nav ("legal channel, then operator", design
 * C): a closed, small set of ids, discovered from `documents/operators/registry.ts` rather than
 * hand-maintained here (see `legalChannels()`'s own header for exactly how) - "which legal channels
 * does this catalogue actually carry a DELIVERY offering for". Every per-country VERDICT on it
 * (`requirement`, `automatic`, `lawful`, `mandatedElsewhere`) is computed HERE, server-side, from the
 * same catalogs `invoice-actions.ts`'s own send preflight reads - never re-derived in the frontend
 * (owner instruction on #527: "the lawfulness verdict comes from the backend").
 */
export interface LegalChannelStatus {
  /** A `documents/operators/schema.ts#OperatorOffering.legalChannel` value, e.g. "pdp"/"sdi"/"ksef"/
   *  "chorus-pro" - NOT a `transports/transport-registry.ts` id (several transport ids can share one
   *  legal channel, e.g. "pdp"/"billit"/"invopop"/"iopole" all implement "pdp" - see
   *  `operators/schema.ts`'s own header, "ONE OPERATOR, MANY OFFERINGS"). */
  id: string;
  /** This company's OWN country's `channel-policy/data/<cc>.json` fact for this legal channel, when
   *  one exists - `undefined` for a legal channel that country's file never names (e.g. "sdi" for a
   *  French company). */
  requirement?: ChannelRequirement;
  mandatedFrom?: string;
  effectiveNow?: boolean;
  equivalentProviderIds?: string[];
  provenance?: PolicyProvenance;
  /** True when this company's own country's `b2g-routing/data/<cc>.json` rule already routes a
   *  government recipient through a transport this legal channel offers (today: only "chorus-pro" for
   *  FR) - the company never "chooses" this channel, it only supplies credentials. Independent of
   *  `requirement` above; a legal channel can be both (Italy's "sdi" is its own domestic mandate AND
   *  its own B2G transport) - the frontend shows the mandate badge in that case, never both at once,
   *  see `channels.settings.tsx`'s own render. */
  automatic: boolean;
  /** True when this legal channel is usable for this company's own country without being refused by
   *  the send preflight for a domestic operation - i.e. `requirement` is set (suggested OR mandated:
   *  a merely-suggested channel is never itself "refused", only NOT yet chosen) or `automatic` is
   *  true. False means "outside your invoicing country" (design C's own wording) - still visible,
   *  still browsable, never connectable from this screen. */
  lawful: boolean;
  /** Every OTHER country whose own `channel-policy` file names this legal channel (mandated or
   *  suggested) - lets the screen explain WHOSE law a locked channel actually belongs to instead of a
   *  bare "not for you" (design C's own "the reason is written on the button"). Never includes this
   *  company's own country (that case is `requirement`/`lawful` above). Empty for a legal channel no
   *  country's channel-policy file names at all (e.g. "chorus-pro" - a B2G routing fact, never a
   *  channel-policy one). */
  mandatedElsewhere: { countryCode: string; requirement: ChannelRequirement }[];
}

/**
 * Issue #527 - the settings screen's top banner (design A, folded onto design C): this company's OWN
 * country's overall channel-policy situation, ONE fact, computed the same way `suggestedChannels`
 * already is - `tone: 'none'` (never an empty screen) for a country with no fact at all (DE, PT: see
 * `channel-policy/data/de.json`'s own header on why `facts: []` is itself a researched fact, not a
 * gap) - the frontend supplies the SENTENCE (via `t()`, interpolating the fields below), this object
 * only ever supplies the VERDICT.
 */
export interface ChannelPolicyBanner {
  /** The active company's own resolved country - `undefined` only when it cannot be resolved at all
   *  (`resolveCompanyCountryCode`), the same "no guess" case `suggestedChannels` already returns `[]`
   *  for. */
  countryCode?: string;
  tone: 'mandated' | 'suggested' | 'none';
  /** Present for `tone !== 'none'` - which legal channel the banner is about. */
  legalChannelId?: string;
  mandatedFrom?: string;
  effectiveNow?: boolean;
  provenance?: PolicyProvenance;
}

/**
 * What `GET /api/company/channels`'s own `reportingObligations` array returns — a NEW concept
 * ("declaration"), never a widened `ChannelPolicyStatus`: a declarative-reporting
 * obligation (NAV/myDATA) is not "this country's stance on a DELIVERY channel", it says nothing at
 * all about how an invoice reaches the buyer — see `documents/reporting/report-on-send.ts`'s own
 * header for the full "a country is data, a declaration is not a transport" reasoning. Kept as its
 * own, separate array (rather than folded into `suggested` with a widened `requirement` enum) so the
 * settings screen can render it with its own, visually distinct "Declaration" badge without having to
 * first decide "is this ACTUALLY a channel policy fact in disguise" — it categorically is not one.
 */
export interface ReportingObligationStatus {
  providerId: string;
  appliesTo: ReportableDocumentType;
  provenance: PolicyProvenance;
}

export interface UpsertChannelConfigBody {
  environment?: string;
  config: Record<string, unknown>;
  isActive?: boolean;
}

/** Coerce an untrusted string to a valid ChannelEnvironment, defaulting to TEST — same convention
 *  the removed compliance engine's own channel-settings.service.ts used for the identical enum. */
function toChannelEnvironment(value: string | undefined): ChannelEnvironment {
  if (value === ChannelEnvironment.PROD) return ChannelEnvironment.PROD;
  return ChannelEnvironment.TEST;
}

/** 256 random bits, hex-encoded — the same entropy budget `share-link-token.ts#generateShareLinkToken`
 *  uses for its own high-entropy value, kept in the clear here for the reason `pushToken`'s own schema
 *  comment gives (never the confidentiality boundary, only a scoping label; must stay legible so it
 *  can be shown back to the company that needs to re-paste it into a portal). */
function generatePushToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * "Transports nationaux" — the credentials layer REPRISED from git tag
 * `avant-refonte-documents` (`channel-credentials.service.ts` + `channel-settings.service.ts`,
 * merged into ONE service here: the old split existed to keep the compliance module decoupled from
 * `invoices`, a cycle this codebase's `documents`/`company` modules do not have — see this file's own
 * git history for the two services this used to be). `resolve`/`resolveActive`/`listActiveByProvider`/
 * `reEncrypt` are the surface a TRANSPORT calls (the "port" role); `listCompanyChannels`/
 * `upsertChannelConfig`/`deleteChannelConfig` back the settings-screen controller.
 *
 * `Controller → Service → Prisma`: this is the ONE place `CompanyChannelConfig` rows are read or
 * written — `channels.controller.ts` never touches Prisma directly.
 */
@Injectable()
export class ChannelCredentialsService {
  private readonly logger = new Logger(ChannelCredentialsService.name);

  // ---------------------------------------------------------------------------
  // The PORT surface — what a transport calls to actually deliver something.
  // ---------------------------------------------------------------------------

  /** Resolve ONE (company, provider, environment) config, decrypted. Null when unconfigured,
   *  inactive, corrupted, or encryption itself is unavailable — a transport's PREFLIGHT (see
   *  `pdp-transport.ts`) treats every one of those identically: "not connected", never a crash. */
  async resolve(
    companyId: string,
    providerId: string,
    environment: string,
  ): Promise<ResolvedChannelConfig | null> {
    if (!isEncryptionAvailable()) return null;

    const row = await prisma.companyChannelConfig.findUnique({
      where: {
        companyId_providerId_environment: {
          companyId,
          providerId,
          environment: toChannelEnvironment(environment),
        },
      },
    });

    if (!row?.isActive) {
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:${environment}`,
        action: 'RESOLVE',
        outcome: 'MISS',
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    return this.decryptRow(row, 'RESOLVE');
  }

  /**
   * Resolve whichever (single) environment is ACTIVE for a provider — what a transport actually
   * calls (it never asks for a specific environment; a company has exactly one active connection
   * per provider by construction of the settings screen, never both TEST and PROD at once).
   */
  async resolveActive(companyId: string, providerId: string): Promise<ResolvedChannelConfig | null> {
    if (!isEncryptionAvailable()) return null;

    const rows = await prisma.companyChannelConfig.findMany({
      where: { companyId, providerId },
      orderBy: { environment: 'asc' },
    });
    const active = rows.filter((r) => r.isActive);

    if (active.length === 0) {
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:*`,
        action: 'RESOLVE_ACTIVE',
        outcome: 'MISS',
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    if (active.length > 1) {
      // Should be unreachable through this service's own `upsertChannelConfig` (it never leaves two
      // environments active for the same provider — see that method's own comment), but a transport
      // must never GUESS which one to use if it ever happens (a stray direct DB write, a bug):
      // refuse loudly rather than pick one silently.
      this.logger.error(
        `Multiple active configs for company ${companyId} provider ${providerId}: ` +
          `[${active.map((r) => r.environment).join(', ')}]. Exactly one must be active.`,
      );
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:*`,
        action: 'RESOLVE_ACTIVE',
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
        context: { reason: 'multiple_active', count: active.length },
      });
      return null;
    }

    return this.decryptRow(active[0], 'RESOLVE_ACTIVE');
  }

  /**
   * Every ACTIVE (company, environment) config for a provider, across ALL companies — REPRISED for
   * a future inbound poller the same shape as the removed `KsefInboxPort` used it for (see this
   * method's own header in the removed compliance engine); nothing calls it yet (PDP has no poller here yet),
   * kept because the reuse is deliberate and a future poller should not have to
   * reinvent it.
   */
  async listActiveByProvider(providerId: string): Promise<ActiveChannelConfig[]> {
    if (!isEncryptionAvailable()) return [];

    const rows = await prisma.companyChannelConfig.findMany({ where: { providerId, isActive: true } });
    const results: ActiveChannelConfig[] = [];
    for (const row of rows) {
      try {
        const config = decryptJson<Record<string, unknown>>(row.config);
        credentialAudit.emit({
          companyId: row.companyId,
          credentialRef: `${providerId}:${row.environment}`,
          action: 'RESOLVE_ACTIVE',
          outcome: 'HIT',
          timestamp: new Date().toISOString(),
          context: { reason: 'listActiveByProvider' },
        });
        results.push({
          companyId: row.companyId,
          providerId: row.providerId,
          channel: row.channel,
          environment: row.environment,
          config,
          isActive: row.isActive,
        });
      } catch {
        credentialAudit.emit({
          companyId: row.companyId,
          credentialRef: `${providerId}:${row.environment}`,
          action: 'RESOLVE_ACTIVE',
          outcome: 'ERROR',
          timestamp: new Date().toISOString(),
          context: { reason: 'decrypt_failed_listActiveByProvider' },
        });
      }
    }
    return results;
  }

  /**
   * §188 rotation seam — re-encrypt a stored blob under the CURRENT `CREDENTIALS_ENCRYPTION_KEY`
   * (idempotent when the key has not changed). REPRISED verbatim from the removed compliance engine: no DB migration
   * needed for a key rotation, only new ciphertext in the same column.
   */
  async reEncrypt(companyId: string, providerId: string, environment: string): Promise<boolean> {
    if (!isEncryptionAvailable()) return false;

    const row = await prisma.companyChannelConfig.findUnique({
      where: {
        companyId_providerId_environment: {
          companyId,
          providerId,
          environment: toChannelEnvironment(environment),
        },
      },
    });
    if (!row) return false;

    try {
      const config = decryptJson<Record<string, unknown>>(row.config);
      const newEncrypted = encryptJson(config);
      await prisma.companyChannelConfig.update({
        where: { id: row.id },
        data: { config: newEncrypted, updatedAt: new Date() },
      });
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:${environment}`,
        action: 'ROTATE',
        outcome: 'HIT',
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      this.logger.error(
        `reEncrypt failed for company ${companyId} provider ${providerId}: ${(err as Error).message}`,
      );
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:${environment}`,
        action: 'ROTATE',
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
      });
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // The CONTROLLER surface — this module's own channels.controller.ts's settings screen.
  // ---------------------------------------------------------------------------

  /** Existing channel configs for a company — STATUS ONLY, see `ChannelConfigStatus`'s own header. */
  async listCompanyChannels(companyId: string): Promise<ChannelConfigStatus[]> {
    const rows = await prisma.companyChannelConfig.findMany({
      where: { companyId },
      orderBy: [{ providerId: 'asc' }, { environment: 'asc' }],
    });
    const countryCode = await resolveCompanyCountryCode(companyId);
    // Computed ONCE per call, against "now" - the same country-level, no-invoice comparison
    // `suggestedChannels`'s own `effectiveNow` already makes (see `blockedBySend`'s own header on why
    // this is deliberately never `activeChannelMandateForOperation`, which needs an invoice this
    // listing does not have).
    const activeMandate = countryCode
      ? activeChannelMandateFor(countryCode, new Date().toISOString())
      : undefined;
    // See `computeBlockedBySend`'s own header on why this is read here too - a channel this
    // company's own B2G routing selects automatically is never subject to the domestic mandate.
    const b2gTransportId = countryCode ? (await resolveB2gRoutingRule(countryCode))?.transportId : undefined;

    return Promise.all(
      rows.map(async (row) => ({
        providerId: row.providerId,
        channel: row.channel,
        environment: row.environment,
        isActive: row.isActive,
        pushToken: row.pushToken,
        operatorId: await this.resolveOperatorId(row),
        blockedBySend: this.computeBlockedBySend(row, activeMandate, b2gTransportId),
      })),
    );
  }

  /** See `ChannelConfigStatus.blockedBySend`'s own header. */
  private computeBlockedBySend(
    row: CompanyChannelConfig,
    activeMandate: ReturnType<typeof activeChannelMandateFor>,
    b2gTransportId: string | undefined,
  ): boolean | undefined {
    if (!row.isActive || !activeMandate) return undefined;
    if (row.providerId === activeMandate.providerId) return false;
    if (activeMandate.equivalentProviderIds?.includes(row.providerId)) return false;
    // Issue #527 - a connected provider whose OWN operator offering implements the exact SAME legal
    // channel the mandate names also satisfies it, even when its own transport id differs from the
    // mandate's literal `providerId` - e.g. Iopole/Billit/Invopop each carry their own dedicated
    // transport id but all implement "pdp" (see `operators/schema.ts`'s own "ONE OPERATOR, MANY
    // OFFERINGS" header). Found live by this issue's own e2e coverage: connecting Iopole for a French
    // company was flagged "blocked" the instant it connected, which is what led to `fr.json`'s own
    // `equivalentProviderIds` addition alongside this generic fallback (a future operator needs no
    // second data-file edit to be recognized here, as long as its OWN offering is catalogued).
    const candidateLegalChannels = defaultOperatorCatalog
      .matchesForTransportId(row.providerId)
      .map((match) => match.offering.legalChannel);
    if (candidateLegalChannels.includes(activeMandate.providerId)) return false;
    // A channel this company's own B2G routing selects automatically (e.g. "chorus-pro" for France)
    // is NEVER evaluated against the domestic mandate at all - `resolveB2gInvoiceTransport`
    // (invoice-actions.ts) short-circuits BEFORE the mandate check ever runs, for ANY invoice whose
    // client is government. Flagging it "blocked" here would be actively misleading: unlike a
    // channel that genuinely stopped satisfying the mandate, this one was never trying to - it
    // keeps working, for its own purpose, entirely unaffected by this company's domestic mandate.
    if (b2gTransportId && row.providerId === b2gTransportId) return false;
    return true;
  }

  /**
   * Issue #526 - resolve this row's `providerId` (+, when genuinely ambiguous, its own connected
   * `baseUrl`) to a `documents/operators/` catalogue entry id. Owner review of PR #528: an operator
   * can implement more than one offering, so resolution answers "operator AND offering" internally
   * (`OperatorCatalog.resolveForTransportConfig`) - this method only ever hands the CALLER the
   * operator's own id, since a `CompanyChannelConfig` row's own `providerId` already pins down WHICH
   * offering matched (the offering's own `transportId` is exactly that `providerId`). The COMMON case
   * (every provider today except a hypothetical future second "pdp"-family offering) never touches
   * the encrypted `config` blob at all: `OperatorCatalog.matchesForTransportId` already answers
   * unambiguously from `providerId` alone, and only a transport id with MORE than one catalogued
   * offering (today: none - see `operators/registry.spec.ts`'s own header on why "pdp" is
   * unconditional too, for now) needs a decrypt to read `baseUrl` - kept cheap on purpose, never a
   * blanket decrypt-every-row-every-call. A decrypt failure here degrades to `null` (same "corrupted
   * blob or wrong key → looks unconfigured, never crash" discipline `decryptRow` already holds), never
   * a thrown error out of a LIST endpoint.
   */
  private async resolveOperatorId(row: CompanyChannelConfig): Promise<string | null> {
    const candidates = defaultOperatorCatalog.matchesForTransportId(row.providerId);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].operator.id;

    try {
      const config = decryptJson<Record<string, unknown>>(row.config);
      credentialAudit.emit({
        companyId: row.companyId,
        credentialRef: `${row.providerId}:${row.environment}`,
        action: 'RESOLVE',
        outcome: 'HIT',
        timestamp: new Date().toISOString(),
        context: { reason: 'resolveOperatorId' },
      });
      return defaultOperatorCatalog.resolveForTransportConfig(row.providerId, config)?.operator.id ?? null;
    } catch {
      credentialAudit.emit({
        companyId: row.companyId,
        credentialRef: `${row.providerId}:${row.environment}`,
        action: 'RESOLVE',
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
        context: { reason: 'resolveOperatorId_decrypt_failed' },
      });
      return null;
    }
  }

  /**
   * What this company's OWN country says about each channel (a suggestion, or a mandate —
   * `transports/channel-policy/`), regardless of whether it is
   * already connected: the settings screen decides how to render "already connected" vs "suggested/
   * mandated, not yet connected" by cross-referencing this against `listCompanyChannels` itself, so
   * this method never needs to.
   */
  async suggestedChannels(companyId: string): Promise<ChannelPolicyStatus[]> {
    const countryCode = await resolveCompanyCountryCode(companyId);
    if (!countryCode) return [];

    const facts = defaultChannelPolicyCatalog.factsFor(countryCode);
    // Computed ONCE per call, against "now" — see `ChannelPolicyStatus.effectiveNow`'s own header on
    // why this is a deliberately different question from the one `invoice-actions.ts` asks.
    const activeToday = activeChannelMandateFor(countryCode, new Date().toISOString());

    return facts.map((fact) => ({
      providerId: fact.providerId,
      requirement: fact.requirement,
      mandatedFrom: fact.mandatedFrom,
      effectiveNow: fact.requirement === 'mandated' ? activeToday?.providerId === fact.providerId : undefined,
      equivalentProviderIds: fact.equivalentProviderIds,
      provenance: fact.provenance,
    }));
  }

  /**
   * Issue #527 - the settings screen's level-1 nav ("legal channel, then operator", design C) plus its
   * top banner (design A). The closed set of legal channel ids is DISCOVERED from the operator
   * catalogue, never hand-maintained here: every `legalChannel` at least one operator offering
   * declares with `capabilities.emit: true` (a genuine DELIVERY capability, not merely researched) -
   * this is what naturally excludes "pt-at" (Portugal's declaration, `emit: false` on its one
   * offering - see `pt-at.json`) and "peppol" (every seeded offering has `emit: false` today - no
   * transport in this codebase actually exercises it yet, see `acube.json`/`b2brouter.json`'s own
   * notes) without EITHER id ever being named in this method's own code. A future operator that wires
   * a real Peppol transport with `emit: true` would grow this set on its own, with no change here.
   */
  async legalChannels(
    companyId: string,
  ): Promise<{ banner: ChannelPolicyBanner; channels: LegalChannelStatus[] }> {
    const countryCode = await resolveCompanyCountryCode(companyId);

    const legalChannelIds = new Set<string>();
    for (const operator of defaultOperatorCatalog.all()) {
      for (const offering of operator.offerings) {
        if (offering.capabilities.emit) legalChannelIds.add(offering.legalChannel);
      }
    }

    const ownFacts = countryCode ? defaultChannelPolicyCatalog.factsFor(countryCode) : [];
    const ownFactByChannel = new Map(ownFacts.map((fact) => [fact.providerId, fact] as const));
    const activeToday = countryCode
      ? activeChannelMandateFor(countryCode, new Date().toISOString())
      : undefined;
    const b2gRule = countryCode ? await resolveB2gRoutingRule(countryCode) : undefined;

    // Every country's OWN facts, cross-indexed by legal channel id, so a locked channel can say WHOSE
    // mandate it actually is (`LegalChannelStatus.mandatedElsewhere`) - see that field's own header.
    const elsewhereByChannel = new Map<string, { countryCode: string; requirement: ChannelRequirement }[]>();
    for (const file of defaultChannelPolicyCatalog.all()) {
      if (file.countryCode === countryCode) continue;
      for (const fact of file.facts) {
        const list = elsewhereByChannel.get(fact.providerId) ?? [];
        list.push({ countryCode: file.countryCode, requirement: fact.requirement });
        elsewhereByChannel.set(fact.providerId, list);
      }
    }

    const channels: LegalChannelStatus[] = [...legalChannelIds].sort().map((id) => {
      const ownFact: ChannelPolicyFact | undefined = ownFactByChannel.get(id);
      const automatic = b2gRule?.transportId === id;
      return {
        id,
        requirement: ownFact?.requirement,
        mandatedFrom: ownFact?.mandatedFrom,
        effectiveNow: ownFact?.requirement === 'mandated' ? activeToday?.providerId === id : undefined,
        equivalentProviderIds: ownFact?.equivalentProviderIds,
        provenance: ownFact?.provenance,
        automatic,
        lawful: !!ownFact || automatic,
        mandatedElsewhere: elsewhereByChannel.get(id) ?? [],
      };
    });

    const mandatedFact = ownFacts.find((fact) => fact.requirement === 'mandated');
    const suggestedFact = ownFacts.find((fact) => fact.requirement === 'suggested');
    const bannerFact = mandatedFact ?? suggestedFact;
    const banner: ChannelPolicyBanner = {
      countryCode,
      tone: mandatedFact ? 'mandated' : suggestedFact ? 'suggested' : 'none',
      legalChannelId: bannerFact?.providerId,
      mandatedFrom: bannerFact?.mandatedFrom,
      effectiveNow:
        bannerFact?.requirement === 'mandated'
          ? activeToday?.providerId === bannerFact.providerId
          : undefined,
      provenance: bannerFact?.provenance,
    };

    return { banner, channels };
  }

  /**
   * This company's own country's DECLARATIVE-REPORTING obligations ("declaration") —
   * `documents/reporting/data/*.json`, read the same way `suggestedChannels` reads
   * `channel-policy/data/*.json` just above, but a categorically different fact: NEVER a hint about
   * which TRANSPORT to use, always "declare this invoice's data to this authority, regardless of how
   * it was delivered". Empty for every country with no reporting-obligation file (the overwhelming
   * majority) — see `ReportingObligationCatalog.factsFor`'s own header.
   */
  async reportingObligations(companyId: string): Promise<ReportingObligationStatus[]> {
    const countryCode = await resolveCompanyCountryCode(companyId);
    if (!countryCode) return [];

    return defaultReportingObligationCatalog.factsFor(countryCode).map((fact) => ({
      providerId: fact.providerId,
      appliesTo: fact.appliesTo,
      provenance: fact.provenance,
    }));
  }

  /**
   * Create/update a channel config. The blob is encrypted at rest; the RETURN VALUE is
   * status-only (see `ChannelConfigStatus`) — a caller that just supplied the secret does not need
   * it echoed back, and this keeps the "GET never leaks a secret" guarantee true of every response
   * this service ever hands a controller, not just the plain listing.
   *
   * `channel` is derived from `providerId` (uppercased) rather than looked up in a provider
   * registry: wave 1 ships exactly one non-"email" provider ("pdp"), so a real provider→channel
   * taxonomy is deferred until a SECOND provider shares a channel category (wave 2: KSeF/SdI, each
   * its own) actually needs one.
   *
   * At most ONE environment stays active per provider: activating a new one deactivates any other
   * environment already active for the same (company, provider) — a transport's `resolveActive`
   * must never face two active rows to choose between (see that method's own defensive guard).
   */
  async upsertChannelConfig(
    companyId: string,
    providerId: string,
    body: UpsertChannelConfigBody,
  ): Promise<ChannelConfigStatus> {
    if (!isEncryptionAvailable()) {
      throw new ServiceUnavailableException(
        'CREDENTIALS_ENCRYPTION_KEY is not configured on this server — channel credentials cannot ' +
          'be saved. Set it (see utils/secret-crypto.ts) before connecting a channel.',
      );
    }

    const environment = toChannelEnvironment(body.environment);
    const isActive = body.isActive ?? true;
    const channel = providerId.toUpperCase();
    const encrypted = encryptJson(body.config);

    if (isActive) {
      await prisma.companyChannelConfig.updateMany({
        where: { companyId, providerId, environment: { not: environment }, isActive: true },
        data: { isActive: false },
      });
    }

    const row = await prisma.companyChannelConfig.upsert({
      where: { companyId_providerId_environment: { companyId, providerId, environment } },
      // `pushToken` ONLY on `create` — see that column's own schema comment on why an ordinary
      // update (a credential rotation, a re-save) must never regenerate it: a URL already registered
      // with a foreign authority would silently stop resolving to this company the moment it changed.
      create: {
        companyId,
        channel,
        providerId,
        environment,
        config: encrypted,
        isActive,
        pushToken: generatePushToken(),
      },
      update: { config: encrypted, isActive },
    });

    this.logger.log(`Channel config upserted: ${providerId} (${environment}) for company ${companyId}`);
    credentialAudit.emit({
      companyId,
      credentialRef: `${providerId}:${environment}`,
      action: 'UPLOAD',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
    });

    return {
      providerId: row.providerId,
      channel: row.channel,
      environment: row.environment,
      isActive: row.isActive,
      pushToken: row.pushToken,
    };
  }

  /**
   * Resolve which company owns `token` for `providerId` — the scoping half of the "public path
   * token" design (`CompanyChannelConfig.pushToken`'s own header): a `@Public()` push endpoint
   * (`sdi-notifiche.controller.ts`) that cannot authenticate its caller as a specific tenant can
   * still refuse to act on behalf of ANY company it doesn't have a matching, ACTIVE row for. `null`
   * for an unknown token, a token belonging to a DIFFERENT provider, or an inactive/disconnected row
   * — every one of those is "this caller does not speak for a connected channel", never distinguished
   * further (the same "unknown token = null, not an error" discipline `share-links.service.ts
   * #resolvePublicToken` already holds for its own public, unauthenticated caller).
   */
  async resolvePushToken(
    providerId: string,
    token: string,
  ): Promise<{ companyId: string; environment: ChannelEnvironment } | null> {
    if (!token) return null;
    const row = await prisma.companyChannelConfig.findUnique({ where: { pushToken: token } });
    if (!row || row.providerId !== providerId || !row.isActive) return null;
    return { companyId: row.companyId, environment: row.environment };
  }

  /** Disconnects a channel — removes EVERY environment's row for this (company, provider): a
   *  "disconnect" is a whole-channel decision, not a per-environment one (there is no settings-screen
   *  concept of disconnecting only TEST while PROD stays connected). */
  async deleteChannelConfig(companyId: string, providerId: string): Promise<{ deleted: boolean }> {
    const { count } = await prisma.companyChannelConfig.deleteMany({ where: { companyId, providerId } });
    credentialAudit.emit({
      companyId,
      credentialRef: `${providerId}:*`,
      action: 'DELETE',
      outcome: count > 0 ? 'HIT' : 'MISS',
      timestamp: new Date().toISOString(),
    });
    return { deleted: count > 0 };
  }

  // ---------------------------------------------------------------------------
  // Shared decrypt helper
  // ---------------------------------------------------------------------------

  private decryptRow(
    row: CompanyChannelConfig,
    action: 'RESOLVE' | 'RESOLVE_ACTIVE',
  ): ResolvedChannelConfig | null {
    try {
      const config = decryptJson<Record<string, unknown>>(row.config);
      credentialAudit.emit({
        companyId: row.companyId,
        credentialRef: `${row.providerId}:${row.environment}`,
        action,
        outcome: 'HIT',
        timestamp: new Date().toISOString(),
      });
      return {
        providerId: row.providerId,
        channel: row.channel,
        environment: row.environment,
        config,
        isActive: row.isActive,
      };
    } catch {
      // Corrupted blob or wrong key — treat as unconfigured rather than crash (a transport's
      // preflight sees exactly the same "not connected" outcome it would for a missing row).
      credentialAudit.emit({
        companyId: row.companyId,
        credentialRef: `${row.providerId}:${row.environment}`,
        action,
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
        context: { reason: 'decrypt_failed' },
      });
      return null;
    }
  }
}
