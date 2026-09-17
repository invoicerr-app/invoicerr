import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Webhook, WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';

import { DiscordDriver } from './drivers/discord.driver';
import { GenericDriver } from './drivers/generic.driver';
import { IWebhookProvider } from '@/plugins/types';
import { MattermostDriver } from './drivers/mattermost.driver';
import { PluginsService } from '../plugins/plugins.service';
import { Request } from 'express';
import { RocketChatDriver } from './drivers/rocketchat.driver';
import { SlackDriver } from './drivers/slack.driver';
import { TeamsDriver } from './drivers/teams.driver';
import { WebhookDriver } from './drivers/webhook-driver.interface';
import { WebhookUrlValidationError, assertPublicWebhookUrl } from './webhook-url-guard';
import { ZapierDriver } from './drivers/zapier.driver';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';
import { backendPublicUrl } from '@/utils/backend-public-url';
import { ResolvedOutboundUrl, pinnedDispatcher } from '@/utils/outbound-url';
import { decryptJson, encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';
import { isEncryptedWebhookSecret } from './webhook-secret-format';

/** HTTP body for creating a webhook (route contract: only `url` is required). */
export interface WebhookCreateInput {
  url: string;
  type?: WebhookType;
  events?: WebhookEvent[];
  secret?: string;
}

export type WebhookUpdateInput = Partial<WebhookCreateInput>;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  private drivers: WebhookDriver[] = [
    new DiscordDriver(),
    new GenericDriver(),
    new MattermostDriver(),
    new RocketChatDriver(),
    new SlackDriver(),
    new TeamsDriver(),
    new ZapierDriver(),
  ];

  constructor(private readonly pluginsService: PluginsService) {}

  /**
   * Handle a received webhook for a specific plugin
   */
  async handlePluginWebhook(pluginId: string, body: any, req: Request): Promise<any> {
    logger.info(`Processing webhook for plugin: ${pluginId}`, { category: 'webhook', details: { pluginId } });
    // Check that the plugin exists and is active
    const plugin = await prisma.plugin.findFirst({
      where: {
        id: pluginId,
        isActive: true,
        webhookUrl: {
          not: null,
        },
      },
    });

    if (!plugin) {
      logger.warn(`Active plugin with UUID ${pluginId} not found or has no webhook configured`, {
        category: 'webhook',
        details: { pluginId },
      });
      throw new NotFoundException(
        `Active plugin with UUID ${pluginId} not found or has no webhook configured`,
      );
    }

    logger.info(`Found plugin: ${plugin.name} (${plugin.type})`, {
      category: 'webhook',
      details: { pluginId, pluginType: plugin.type },
    });

    // Get the plugin's provider
    const provider = await this.pluginsService.getProviderByType<IWebhookProvider>(plugin.type.toLowerCase());

    if (!provider) {
      logger.warn(`No provider found for plugin type: ${plugin.type}`, {
        category: 'webhook',
        details: { pluginType: plugin.type },
      });
      throw new NotFoundException(`No provider found for plugin type: ${plugin.type}`);
    }

    // Check that the provider has a handleWebhook method
    if (typeof provider.handleWebhook !== 'function') {
      logger.warn(`Provider for plugin ${plugin.name} does not implement handleWebhook method`, {
        category: 'webhook',
        details: { pluginName: plugin.name },
      });
      return { message: 'Webhook received but not handled by provider' };
    }

    // Call the provider's handleWebhook method
    try {
      const result = await provider.handleWebhook(req, body);
      logger.info(`Webhook processed successfully for plugin ${plugin.name}`, {
        category: 'webhook',
        details: { pluginName: plugin.name },
      });
      return result;
    } catch (error) {
      logger.error(`Error in provider webhook handler for plugin ${plugin.name}`, {
        category: 'webhook',
        details: { pluginName: plugin.name, error },
      });
      throw error;
    }
  }

  /**
   * Generate a webhook URL for a given plugin ID — the address the EXTERNAL plugin's own service
   * calls back into `POST /api/webhooks/:uuid` (`webhooks.controller.ts`'s own public endpoint) at.
   * `backendPublicUrl()` (see that function's own header) — never bare `APP_URL`: this URL is called
   * by a third-party SERVER, not opened by a browser.
   */
  generateWebhookUrl(pluginId: string): string {
    return `${backendPublicUrl()}/api/webhooks/${pluginId}`;
  }

  /**
   * SECURITY_AUDIT.md finding #2 (SSRF) — reject a webhook URL that is not a public http(s)
   * endpoint. Called from create/update below, before the row is ever persisted; `send()` re-runs
   * `assertPublicWebhookUrl` itself right before each dispatch (DNS rebinding — see that function's
   * own header). The client only ever sees the one generic message: neither the internal `reason`
   * nor the rejected URL is echoed back or logged, since either would hand an attacker a live oracle
   * to scan internal address ranges with ("is 10.0.3.4 open? what about 172.20.0.1?").
   */
  private async validateWebhookUrl(url: string): Promise<void> {
    try {
      await assertPublicWebhookUrl(url);
    } catch (err) {
      if (err instanceof WebhookUrlValidationError) {
        // Never `err.reason` here: it is precisely "which private range, which port" detail that
        // turns this endpoint into a network-scanning oracle for whoever can create a webhook — see
        // `outbound-url.ts`'s own header. The log line says nothing an attacker doesn't already know
        // (they supplied the URL); it exists only to distinguish this rejection from an unrelated 400.
        this.logger.warn('Rejected webhook URL at write time — failed the outbound-URL SSRF guard');
        throw new HttpException('webhook URL must be a public http(s) endpoint', HttpStatus.BAD_REQUEST);
      }
      throw err;
    }
  }

  /**
   * Encrypt a webhook's plaintext HMAC secret before it ever reaches Prisma. Every other
   * integration credential in this codebase already goes through `secret-crypto.ts` at rest
   * (`CompanyChannelConfig.config` via `channels.service.ts`, `CompanySigningCertificate`'s PFX/pass);
   * `Webhook.secret` was the one column that stayed in the clear.
   *
   * Falls back to storing the plaintext value when `CREDENTIALS_ENCRYPTION_KEY` is not configured —
   * DELIBERATELY different from `channels.service.ts#upsertChannelConfig`, which refuses to save at
   * all in that case: channel credentials are an opt-in feature gated behind that key from day one,
   * but webhook secrets predate it and are not opt-in. Turning webhook creation into a hard failure
   * for every self-hosted instance that never set the key would be a regression this fix must not
   * cause; `migratePlaintextWebhookSecrets` (`webhook-secret-migration.ts`) sweeps up whatever is
   * stored this way the moment a key does become available.
   */
  private encryptSecretForStorage(secret: string): string {
    if (!isEncryptionAvailable()) return secret;
    return encryptJson(secret);
  }

  /**
   * The read-side counterpart, called by `send()` right before computing the HMAC signature.
   * A stored value can be in any of three states at any given time (this method's own three branches,
   * in order): still legacy plaintext (no key was configured when it was written, or the boot
   * migration has not reached it yet) — used as-is, unchanged behavior; an encrypted blob with the key
   * available — decrypted and used; or an encrypted blob with the key NOW missing (rotated away,
   * misconfigured) — unusable, so the send proceeds UNSIGNED rather than HMAC-ing the payload with the
   * literal ciphertext string, which would produce a signature no legitimate receiver could ever
   * verify anyway.
   */
  private resolveSecretForSigning(stored: string | null): string | null {
    if (!stored) return null;
    if (!isEncryptedWebhookSecret(stored)) return stored;

    if (!isEncryptionAvailable()) {
      this.logger.error(
        'Webhook secret is encrypted but CREDENTIALS_ENCRYPTION_KEY is unavailable — sending unsigned',
      );
      return null;
    }

    try {
      return decryptJson<string>(stored);
    } catch {
      this.logger.error('Failed to decrypt webhook secret (corrupted blob or wrong key) — sending unsigned');
      return null;
    }
  }

  private getDriver(type: WebhookType): WebhookDriver {
    const driver = this.drivers.find((d) => d.supports(type));
    if (!driver) {
      this.logger.warn(`No webhook driver found for type: ${type}, using GenericDriver as fallback`);
      return new GenericDriver();
    }
    return driver;
  }

  /**
   * Get a single webhook scoped to the active company, without its secret.
   * Throws 404 when the webhook does not exist or belongs to another company.
   */
  async findOne(companyId: string, id: string) {
    const wh = await prisma.webhook.findFirst({ where: { id, companyId } });
    if (!wh) throw new HttpException('Webhook not found', HttpStatus.NOT_FOUND);

    return { ...wh, secret: undefined };
  }

  /** List all webhooks of the active company, secrets excluded. */
  async list(companyId: string) {
    const webhooks = await prisma.webhook.findMany({ where: { companyId } });

    // Remove secret from response
    return webhooks.map((w) => ({ ...w, secret: undefined }));
  }

  /**
   * Create a webhook for the active company. Returns the full row + company for event dispatch, with
   * `webhook.secret` overridden back to the PLAINTEXT value (never what actually landed in the
   * `secret` column, which is encrypted — see `encryptSecretForStorage`): this is the one deliberate,
   * one-time reveal the settings screen relies on (`webhooks.settings.tsx` shows it once right after
   * creation, then never again — every other read, `findOne`/`list`, strips the column entirely).
   */
  async create(companyId: string, body: WebhookCreateInput) {
    await this.validateWebhookUrl(body.url);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    const plainSecret = body.secret ?? '';
    const storedSecret = plainSecret ? this.encryptSecretForStorage(plainSecret) : plainSecret;

    const webhook = await prisma.webhook.create({
      data: {
        url: body.url,
        type: body.type ?? 'GENERIC',
        events: body.events ?? [],
        secret: storedSecret,
        companyId,
      },
    });

    return { webhook: { ...webhook, secret: plainSecret }, company };
  }

  /** Update a webhook (company-scoped, 404 otherwise). Returns the full updated row + company for event dispatch. */
  async update(companyId: string, id: string, body: WebhookUpdateInput) {
    const existing = await prisma.webhook.findFirst({ where: { id, companyId } });
    if (!existing) throw new HttpException('Webhook not found', HttpStatus.NOT_FOUND);

    if (body.url) await this.validateWebhookUrl(body.url);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    // Only encrypt when the caller is actually SETTING a new secret. `existing.secret` already carries
    // whatever format it was persisted in (an encrypted blob, or still legacy plaintext until the boot
    // migration reaches it) and must never be run back through `encryptSecretForStorage` on an update
    // that leaves it untouched — that would encrypt an already-encrypted blob a second time and make
    // it permanently undecryptable.
    const storedSecret =
      body.secret !== undefined
        ? body.secret
          ? this.encryptSecretForStorage(body.secret)
          : body.secret
        : existing.secret;

    const webhook = await prisma.webhook.update({
      where: { id },
      data: {
        url: body.url ?? existing.url,
        type: body.type ?? existing.type,
        events: body.events ?? existing.events,
        secret: storedSecret,
      },
    });

    return { webhook, company };
  }

  /** Delete a webhook (company-scoped, 404 otherwise). Returns the deleted row + company for event dispatch. */
  async remove(companyId: string, id: string) {
    const existing = await prisma.webhook.findFirst({ where: { id, companyId } });
    if (!existing) throw new HttpException('Webhook not found', HttpStatus.NOT_FOUND);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    await prisma.webhook.delete({ where: { id } });

    return { webhook: existing, company };
  }

  /**
   * Send a webhook to a specified URL with HMAC signature
   */
  async send(webhooks: Webhook[], event: WebhookEvent, payload: any) {
    const results = await Promise.all(
      webhooks.map(async (webhook) => {
        // Re-validate right before dispatch, not just at create/update time: a hostname that
        // resolved to a public IP when the webhook was saved can be repointed at an internal one by
        // the time the event actually fires ("DNS rebinding" — see webhook-url-guard.ts). A webhook
        // failing this check is skipped (reported as a failed send), never allowed to abort the
        // batch for every other webhook of the same event. `resolved` is what makes this a REAL fix
        // rather than a narrowed race: `driver.send` below connects to `resolved.address` directly
        // (via `pinnedDispatcher`) instead of letting `fetch` re-resolve the hostname a second,
        // independent time — which is exactly the gap a short-TTL DNS answer could flip in between.
        let resolved: ResolvedOutboundUrl | null;
        try {
          resolved = await assertPublicWebhookUrl(webhook.url);
        } catch (err) {
          // Never `err.reason` — see `validateWebhookUrl`'s own comment on why.
          const known = err instanceof WebhookUrlValidationError;
          this.logger.warn(
            `Skipped webhook dispatch: URL failed the outbound-URL SSRF guard at send time` +
              (known ? '' : ' (unexpected validation error)'),
          );
          return false;
        }

        const driver = this.getDriver(webhook.type);
        return await driver.send(
          webhook.url,
          {
            event,
            ...payload,
          },
          this.resolveSecretForSigning(webhook.secret),
          pinnedDispatcher(resolved),
        );
      }),
    );
    logger.info(`Webhooks sent for event: ${event}`, {
      category: 'webhook',
      details: { event, count: results.length },
    });
    return results;
  }
}
