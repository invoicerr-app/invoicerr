import { randomBytes } from 'node:crypto';

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { resolveB2gRoutingRule } from '@/modules/documents/b2g-routing/b2g-routing';
import { defaultB2gRoutingCatalog } from '@/modules/documents/b2g-routing/registry';
import {
  resolveCompanyCountryCode,
  resolveCompanyProfile,
} from '@/modules/documents/country-policy/country-policy';
import { PolicyProvenance } from '@/modules/documents/country-policy/schema';
import {
  activeChannelMandateFor,
  channelFactsForSeller,
} from '@/modules/documents/transports/channel-policy/mandate';
import { defaultChannelPolicyCatalog } from '@/modules/documents/transports/channel-policy/registry';
import { ChannelPolicyFact, ChannelRequirement } from '@/modules/documents/transports/channel-policy/schema';
import { defaultOperatorCatalog } from '@/modules/documents/operators/registry';
import { defaultReportingObligationCatalog } from '@/modules/documents/reporting/registry';
import { ReportableDocumentType } from '@/modules/documents/reporting/schema';
import { decryptJson, encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';
import { credentialAudit } from '@/utils/credential-access-audit';
import { ChannelEnvironment, CompanyChannelConfig } from '../../../../prisma/generated/prisma/client';
import { byCodeUnit } from '@/lib/compare';

/** What a transport gets back once credentials are resolved: `config` is already decrypted, and this
 *  shape never leaves the server. */
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

/** What GET returns: status only, never a config value, masked or not. Never letting a secret reach
 *  this shape is sturdier than trusting a masking step on every call site. */
export interface ChannelConfigStatus {
  providerId: string;
  channel: string;
  environment: ChannelEnvironment;
  isActive: boolean;
  /** Not a secret: the settings screen shows it so the company can paste it into a callback URL it
   *  registers with a foreign authority. Null for rows predating the column or providers needing none. */
  pushToken?: string | null;
  /** The `documents/operators/` entry this row's providerId resolves to, never its connected URL or
   *  credentials; null when the catalogue does not know the provider. */
  operatorId?: string | null;
  /** True when the send preflight would refuse this active row for a domestic operation, because the
   *  country mandates a different channel. Undefined for an inactive row or with no mandate in force. */
  blockedBySend?: boolean;
}

/** One row of the settings screen's `suggested` list: the country's stance on one legal channel. */
export interface ChannelPolicyStatus {
  providerId: string;
  requirement: ChannelRequirement;
  /** Present only when `requirement === 'mandated'` (schema.ts guarantees it always is, in that case). */
  mandatedFrom?: string;
  /** True when today already crosses `mandatedFrom`. The send preflight uses the invoice's issueDate
   *  instead; this screen has no document to anchor to. */
  effectiveNow?: boolean;
  /** Passed through from the policy fact, so the frontend never reimplements the equivalence check. */
  equivalentProviderIds?: string[];
  provenance: PolicyProvenance;
}

/**
 * One row of the settings screen's legal-channel nav: the ids come from the operator catalogue, and
 * every per-country verdict is computed here rather than in the frontend.
 */
export interface LegalChannelStatus {
  /** A `documents/operators/schema.ts#OperatorOffering.legalChannel` value, e.g. "pdp" or "sdi"; not a
   *  transport id, since several transports can implement one legal channel. */
  id: string;
  /** This company's own country's fact for this legal channel, when its file names one. */
  requirement?: ChannelRequirement;
  mandatedFrom?: string;
  effectiveNow?: boolean;
  equivalentProviderIds?: string[];
  provenance?: PolicyProvenance;
  /** True when this country's B2G routing already sends government recipients through this channel, so
   *  the company only supplies credentials. Independent of `requirement`. */
  automatic: boolean;
  /** True when the send preflight would accept this channel for a domestic operation: the country
   *  names it, routes to it automatically, or enforces no mandate at all and no other country claims
   *  it. False means the country mandates a different channel. */
  lawful: boolean;
  /** Every other country whose policy file names this channel, so the screen can say whose law a locked
   *  channel belongs to. Never this company's own country. */
  mandatedElsewhere: { countryCode: string; requirement: ChannelRequirement }[];
  /** Every other country whose B2G routing routes through this channel without the company choosing
   *  it. With `mandatedElsewhere`, tells a national portal apart from a cross-border network. */
  automaticElsewhere: string[];
}

/**
 * The settings screen's top banner: this company's country's overall channel situation, one verdict.
 * The frontend supplies the sentence; `tone: 'none'` covers a country with no fact at all.
 */
export interface ChannelPolicyBanner {
  /** The company's resolved country; undefined when it cannot be resolved, never a guess. */
  countryCode?: string;
  tone: 'mandated' | 'suggested' | 'none';
  /** Present for `tone !== 'none'` - which legal channel the banner is about. */
  legalChannelId?: string;
  mandatedFrom?: string;
  effectiveNow?: boolean;
  provenance?: PolicyProvenance;
}

/**
 * What the `reportingObligations` array returns: a declarative-reporting obligation (NAV/myDATA) is
 * not a delivery channel, so it gets its own array and its own badge rather than a widened requirement.
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

/** Coerce an untrusted string to ChannelEnvironment, defaulting to TEST. */
function toChannelEnvironment(value: string | undefined): ChannelEnvironment {
  if (value === ChannelEnvironment.PROD) return ChannelEnvironment.PROD;
  return ChannelEnvironment.TEST;
}

/** 256 random bits, hex-encoded. Kept in the clear because it is a scoping label, not a secret, and the
 *  company must be able to read it back and paste it into a portal. */
function generatePushToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * The per-company channel credentials: transports call `resolve`/`resolveActive`/`listActiveByProvider`/
 * `reEncrypt`, the settings screen calls the list/upsert/delete methods. This is the only place
 * `CompanyChannelConfig` rows are read or written.
 */
@Injectable()
export class ChannelCredentialsService {
  private readonly logger = new Logger(ChannelCredentialsService.name);

  // ---------------------------------------------------------------------------
  // The PORT surface — what a transport calls to actually deliver something.
  // ---------------------------------------------------------------------------

  /** Resolves one (company, provider, environment) config, decrypted. Null when unconfigured, inactive,
   *  corrupted or encryption is unavailable: a transport's preflight treats all as "not connected". */
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
   * Resolves the single environment that is active for a provider: a company has one active connection
   * per provider, so a transport never names an environment.
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
      // Upsert never leaves two environments active, but a stray write must never make a transport
      // guess: refuse loudly instead of picking one.
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

  /** Every active config of a provider across all companies. Unused today; a future inbound poller
   *  needs exactly this shape. */
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
   * Re-encrypts a stored blob under the current key, so a key rotation needs no migration: the column
   * keeps its shape, only the ciphertext changes. Idempotent when the key has not changed.
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
    // Computed once per call against "now": country-level only, with no invoice to anchor to.
    const activeMandate = countryCode
      ? activeChannelMandateFor(
          countryCode,
          new Date().toISOString(),
          undefined,
          await resolveCompanyProfile(companyId),
        )
      : undefined;
    // A channel the company's own B2G routing selects is never subject to the domestic mandate.
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
    // A provider whose operator offering implements the mandate's legal channel satisfies it, even
    // under a different transport id: several transports implement "pdp".
    const candidateLegalChannels = defaultOperatorCatalog
      .matchesForTransportId(row.providerId)
      .map((match) => match.offering.legalChannel);
    if (candidateLegalChannels.includes(activeMandate.providerId)) return false;
    // A channel the B2G routing selects is evaluated by that path, which short-circuits before the
    // mandate check: flagging it here would be misleading, it was never trying to satisfy the mandate.
    if (b2gTransportId && row.providerId === b2gTransportId) return false;
    return true;
  }

  /**
   * Resolves a row's providerId, plus its connected baseUrl only when the id is ambiguous, to a
   * catalogue operator id. Most rows never decrypt: the transport id alone is unambiguous. A decrypt
   * failure degrades to null, never an error out of a list endpoint.
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

    const sellerProfile = await resolveCompanyProfile(companyId);
    const facts = channelFactsForSeller(countryCode, sellerProfile);
    // Computed ONCE per call, against "now" — see `ChannelPolicyStatus.effectiveNow`'s own header on
    // why this is a deliberately different question from the one `invoice-actions.ts` asks.
    const activeToday = activeChannelMandateFor(
      countryCode,
      new Date().toISOString(),
      undefined,
      sellerProfile,
    );

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
   * The settings screen's legal-channel nav and banner. The channel ids are discovered from the
   * operator catalogue (any offering whose capabilities emit), never hand-maintained here.
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

    const sellerProfile = await resolveCompanyProfile(companyId);
    const ownFacts = countryCode ? channelFactsForSeller(countryCode, sellerProfile) : [];
    const ownFactByChannel = new Map(ownFacts.map((fact) => [fact.providerId, fact] as const));
    const activeToday = countryCode
      ? activeChannelMandateFor(countryCode, new Date().toISOString(), undefined, sellerProfile)
      : undefined;
    const b2gRule = countryCode ? await resolveB2gRoutingRule(countryCode) : undefined;

    // Cross-indexed by channel so a locked one can say whose law it belongs to.
    const elsewhereByChannel = new Map<string, { countryCode: string; requirement: ChannelRequirement }[]>();
    for (const file of defaultChannelPolicyCatalog.all()) {
      if (file.countryCode === countryCode) continue;
      for (const fact of file.facts) {
        const list = elsewhereByChannel.get(fact.providerId) ?? [];
        if (list.some((entry) => entry.countryCode === file.countryCode)) continue;
        list.push({ countryCode: file.countryCode, requirement: fact.requirement });
        elsewhereByChannel.set(fact.providerId, list);
      }
    }

    // Any mandate at all in this country, on any channel: a channel with no national home (Peppol) is
    // lawful only while nothing here forces a different one.
    const hasDomesticMandate = ownFacts.some((fact) => fact.requirement === 'mandated');

    // Other countries' automatic B2G channels, cross-indexed the same way, so a national portal is not
    // mistaken for a country-neutral network like Peppol. Read from the in-memory catalogue.
    const automaticElsewhereByChannel = new Map<string, string[]>();
    for (const otherCountryCode of defaultB2gRoutingCatalog.countries()) {
      if (otherCountryCode === countryCode) continue;
      const rule = defaultB2gRoutingCatalog.ruleFor(otherCountryCode);
      if (!rule) continue;
      const list = automaticElsewhereByChannel.get(rule.transportId) ?? [];
      list.push(otherCountryCode);
      automaticElsewhereByChannel.set(rule.transportId, list);
    }

    const channels: LegalChannelStatus[] = [...legalChannelIds].sort(byCodeUnit).map((id) => {
      const ownFact: ChannelPolicyFact | undefined = ownFactByChannel.get(id);
      const automatic = b2gRule?.transportId === id;
      const mandatedElsewhere = elsewhereByChannel.get(id) ?? [];
      const automaticElsewhere = automaticElsewhereByChannel.get(id) ?? [];
      const hasNoHomeAnywhere = mandatedElsewhere.length === 0 && automaticElsewhere.length === 0;
      const lawful = !!ownFact || automatic || (hasNoHomeAnywhere && !hasDomesticMandate);
      return {
        id,
        requirement: ownFact?.requirement,
        mandatedFrom: ownFact?.mandatedFrom,
        effectiveNow: ownFact?.requirement === 'mandated' ? activeToday?.providerId === id : undefined,
        equivalentProviderIds: ownFact?.equivalentProviderIds,
        provenance: ownFact?.provenance,
        automatic,
        lawful,
        mandatedElsewhere,
        automaticElsewhere,
      };
    });

    // This country's own channel first, then an automatic B2G one, then a stable order: the priority
    // is the verdict computed here, so the frontend never re-ranks.
    const priorityOf = (channel: LegalChannelStatus): number => {
      if (channel.requirement === 'mandated') return 0;
      if (channel.requirement === 'suggested') return 1;
      if (channel.automatic) return 2;
      return 3;
    };
    channels.sort((a, b) => priorityOf(a) - priorityOf(b) || a.id.localeCompare(b.id));

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
   * Create/update a channel config. The blob is encrypted at rest and the return value is status-only,
   * so no response ever echoes a secret. Activating one environment deactivates the others for the
   * same provider, since `resolveActive` must never face two active rows.
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
      // Only on `create`: regenerating on a re-save would silently break a callback URL the company
      // already registered with a foreign authority.
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
   * Resolves which company owns a push token. A public endpoint cannot authenticate its caller, so it
   * must refuse unless an active row matches both the token and the provider; anything else is null.
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

  /** Disconnects a channel: removes every environment's row for this provider, since "disconnect" is a
   *  whole-channel decision. */
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
      // Corrupted blob or wrong key: treat as unconfigured rather than crash, the same "not connected"
      // outcome a transport's preflight expects for a missing row.
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
