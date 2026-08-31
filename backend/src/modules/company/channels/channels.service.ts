import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { resolveCompanyCountryCode } from '@/modules/documents/country-policy/country-policy';
import { PolicyProvenance } from '@/modules/documents/country-policy/schema';
import { activeChannelMandateFor } from '@/modules/documents/transports/channel-policy/mandate';
import { defaultChannelPolicyCatalog } from '@/modules/documents/transports/channel-policy/registry';
import { ChannelRequirement } from '@/modules/documents/transports/channel-policy/schema';
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

/** What GET returns — status ONLY, never a config value (masked or not): the task this module
 *  serves has ONE non-negotiable rule ("le GET dit configuré/actif/environnement, pas les valeurs"),
 *  and the surest way to honor it is to never let a secret reach this type's own shape at all,
 *  rather than trust a per-field masking step (the old repo's own `maskSecrets`) to run correctly on
 *  every call site forever. See `channels.service.spec.ts`'s own mutation-proof test. */
export interface ChannelConfigStatus {
  providerId: string;
  channel: string;
  environment: ChannelEnvironment;
  isActive: boolean;
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

/**
 * Item 10 (root TODO), "transports nationaux" — the credentials layer REPRISED from git tag
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
   * method's own header at the repère); nothing in wave 1 calls it yet (PDP has no poller here — see
   * TODO_ISSUES.md), kept because the task asks for the reuse and a future poller should not have to
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
   * (idempotent when the key has not changed). REPRISED verbatim from the repère: no DB migration
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
  // The CONTROLLER surface — company/channels.controller.ts's settings screen.
  // ---------------------------------------------------------------------------

  /** Existing channel configs for a company — STATUS ONLY, see `ChannelConfigStatus`'s own header. */
  async listCompanyChannels(companyId: string): Promise<ChannelConfigStatus[]> {
    const rows = await prisma.companyChannelConfig.findMany({
      where: { companyId },
      orderBy: [{ providerId: 'asc' }, { environment: 'asc' }],
    });
    return rows.map((row) => ({
      providerId: row.providerId,
      channel: row.channel,
      environment: row.environment,
      isActive: row.isActive,
    }));
  }

  /**
   * What this company's OWN country says about each channel (item 10's "le pays suggère son canal",
   * item 11's "le pays impose son canal" — `transports/channel-policy/`), regardless of whether it is
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
   * its own) actually needs one — see root TODO item 10's own two-wave split.
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
      create: { companyId, channel, providerId, environment, config: encrypted, isActive },
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
    };
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
