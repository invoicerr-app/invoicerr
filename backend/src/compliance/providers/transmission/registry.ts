import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger, defaultLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelSpec } from '../../profiles/schema';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { InvoiceMailPort } from './invoice-mail-port';
import { TransmissionProvider } from './transmission-provider';
import type { BuyerDirectoryPort } from './buyer-directory-port';
import {
  EmailTransmissionProvider,
  KsefTransmissionProvider,
  OseTransmissionProvider,
  PacTransmissionProvider,
  PdpTransmissionProvider,
  PeppolTransmissionProvider,
  PrintTransmissionProvider,
  SdiTransmissionProvider,
} from './providers';
import { NATIONAL_PORTAL_PROVIDERS } from './national-portals';

export class TransmissionProviderRegistry {
  private readonly byChannel = new Map<ChannelType, TransmissionProvider>();
  private readonly byId = new Map<string, TransmissionProvider>();
  readonly credentials?: ChannelCredentialsPort;

  /**
   * In-memory idempotency store: maps a per-channel idempotency key to the
   * Unix ms timestamp of the first send.  A second transmitAll call with the
   * same (idempotencyKeyBase + provider + channel-index) within the TTL window
   * returns SKIPPED instead of forwarding to the provider, preventing
   * double-submission on retries.
   *
   * Scope: process lifetime only (no persistence).  The TTL window (5 min) is
   * sized so that an in-flight retry cycle is caught but a deliberate re-issue
   * hours later is not suppressed.
   */
  private readonly _seenKeys = new Map<string, number>(); // key → timestamp ms
  private readonly _idempotencyTtlMs = 5 * 60 * 1000;   // 5 minutes

  private _isDuplicate(key: string): boolean {
    const ts = this._seenKeys.get(key);
    if (ts === undefined) return false;
    if (Date.now() - ts > this._idempotencyTtlMs) {
      this._seenKeys.delete(key);
      return false;
    }
    return true;
  }

  private _markSeen(key: string): void {
    this._seenKeys.set(key, Date.now());
  }

  constructor(providers?: TransmissionProvider[] | {
    mail?: InvoiceMailPort;
    credentials?: ChannelCredentialsPort;
    /** §179 — optional directory for buyer routing resolution (cached externally). */
    buyerDirectory?: BuyerDirectoryPort;
  }) {
    let list: TransmissionProvider[];
    if (Array.isArray(providers)) {
      list = providers;
      this.credentials = undefined;
    } else {
      this.credentials = providers?.credentials;
      const dir = !Array.isArray(providers) ? providers?.buyerDirectory : undefined;
      list = [
        new EmailTransmissionProvider(providers?.mail),
        new PeppolTransmissionProvider(providers?.credentials, undefined, undefined, dir),
        new PdpTransmissionProvider(providers?.credentials, dir),
        new PacTransmissionProvider(providers?.credentials),
        new SdiTransmissionProvider(providers?.credentials),
        new KsefTransmissionProvider(providers?.credentials),
        new OseTransmissionProvider(providers?.credentials),
        new PrintTransmissionProvider(),
        // Dedicated national portals — selected by ChannelSpec.providerId.
        // There is NO generic GOV_PORTAL_API default: every GOV_PORTAL_API channel MUST carry a
        // providerId pointing at a named portal (ksef, sefaz, zatca, choruspro, …).
        ...NATIONAL_PORTAL_PROVIDERS,
      ];
    }
    for (const p of list) {
      this.byId.set(p.id, p);
      // First registered for a channel becomes the generic default for that channel.
      if (!this.byChannel.has(p.channel)) this.byChannel.set(p.channel, p);
    }
  }

  get(channel: ChannelType): TransmissionProvider | null {
    return this.byChannel.get(channel) ?? null;
  }

  getById(id: string): TransmissionProvider | null {
    return this.byId.get(id) ?? null;
  }

  /** All registered providers (deduplicated by id). */
  allProviders(): TransmissionProvider[] {
    return Array.from(this.byId.values());
  }

  /**
   * Resolve a ChannelSpec to a provider.
   * - An explicit providerId always wins (e.g. 'ksef', 'choruspro', 'sefaz').
   * - GOV_PORTAL_API has NO generic channel default: a providerId is mandatory.
   *   A bare { type: 'GOV_PORTAL_API' } or an unknown providerId returns null → SKIPPED.
   * - All other channel types fall back to their first-registered provider.
   */
  resolve(spec: ChannelSpec): TransmissionProvider | null {
    if (spec.providerId) {
      const byId = this.byId.get(spec.providerId);
      if (byId) return byId;
      // Unknown providerId: for GOV_PORTAL_API there is no channel fallback — return null.
      if (spec.type === 'GOV_PORTAL_API') return null;
    }
    // GOV_PORTAL_API always requires an explicit providerId; never use byChannel for it.
    if (spec.type === 'GOV_PORTAL_API') return null;
    return this.byChannel.get(spec.type) ?? null;
  }

  async transmitAll(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    plan: CompliancePlan,
    idempotencyKeyBase: string,
    log: ComplianceLogger = defaultLogger,
  ): Promise<TransmissionResult[]> {
    const results: TransmissionResult[] = [];
    for (let i = 0; i < plan.channels.length; i++) {
      const spec = plan.channels[i];
      const provider = this.resolve(spec);
      if (!provider) {
        if (spec.type === 'GOV_PORTAL_API' && !spec.providerId) {
          log.warn('transmission', 'GOV_PORTAL_API requires a providerId (named portal) — skipping');
          results.push({ channel: spec.type, status: 'SKIPPED', notes: ['GOV_PORTAL_API requires a providerId (named portal)'] });
        } else {
          log.warn('transmission', `no provider for channel ${spec.type}${spec.providerId ? `/${spec.providerId}` : ''}`);
          results.push({ channel: spec.type, status: 'SKIPPED', notes: ['no provider'] });
        }
        continue;
      }

      // Resolve credentials when the provider declares a configSchema and the ctx carries a company id.
      let resolvedConfig: ResolvedChannelConfig | undefined;
      if (provider.configSchema && this.credentials && ctx.supplierCompanyId) {
        const providerId = spec.providerId ?? provider.id;
        const resolved = await this.credentials.resolveActive(ctx.supplierCompanyId, providerId);
        if (!resolved || !resolved.isActive) {
          if (provider.optionalConfig) {
            // Optional config: proceed without it — provider will fall back to global defaults.
            log.info('transmission', `no per-company config for ${providerId} — using global default`);
          } else {
            log.info('transmission', `channel not configured for company (${providerId}) — skipping`);
            results.push({ channel: spec.type, status: 'SKIPPED', notes: [`channel ${providerId} not configured for company`] });
            continue;
          }
        } else {
          resolvedConfig = resolved;
        }
      }

      const iKey = `${idempotencyKeyBase}:${provider.id}:${i}`;
      if (this._isDuplicate(iKey)) {
        log.info('transmission', `idempotency: duplicate send suppressed (key=${iKey})`);
        results.push({ channel: spec.type, status: 'SKIPPED', notes: [`idempotency: duplicate send suppressed (key=${iKey})`] });
        continue;
      }
      this._markSeen(iKey);
      results.push(await provider.transmit(artifacts, ctx, plan, iKey, log, resolvedConfig));
    }
    return results;
  }
}

export const defaultTransmissionRegistry = new TransmissionProviderRegistry();
