import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Webhook, WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';

import { DiscordDriver } from './drivers/discord.driver';
import { GenericDriver } from './drivers/generic.driver';
import { MattermostDriver } from './drivers/mattermost.driver';
import { RocketChatDriver } from './drivers/rocketchat.driver';
import { SlackDriver } from './drivers/slack.driver';
import { TeamsDriver } from './drivers/teams.driver';
import { WebhookDriver } from './drivers/webhook-driver.interface';
import { WebhookUrlValidationError, assertPublicWebhookUrl } from './webhook-url-guard';
import { ZapierDriver } from './drivers/zapier.driver';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';
import { ResolvedOutboundUrl, pinnedDispatcher } from '@/utils/outbound-url';
import { decryptJson, encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';
import { isEncryptedWebhookSecret } from './webhook-secret-format';
import { assertDemoSendingAllowed } from '@/modules/demo/demo-blocked';

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

  /**
   * SSRF guard at write time: a tenant-supplied URL is dereferenced by this server. The client only
   * sees a generic message; neither the reason nor the URL goes back or into a log, since either is a
   * scanning oracle. `send` re-runs the guard before each dispatch, for DNS rebinding.
   */
  private async validateWebhookUrl(url: string): Promise<void> {
    try {
      await assertPublicWebhookUrl(url);
    } catch (err) {
      if (err instanceof WebhookUrlValidationError) {
        // Never the reason: it is exactly the "which private range" detail that would turn this
        // endpoint into a scanner. The line exists only to separate this from an unrelated 400.
        this.logger.warn('Rejected webhook URL at write time — failed the outbound-URL SSRF guard');
        throw new HttpException('webhook URL must be a public http(s) endpoint', HttpStatus.BAD_REQUEST);
      }
      throw err;
    }
  }

  /**
   * Refuses to store a secret it cannot encrypt rather than falling back to plaintext: the value is
   * the HMAC key the receiver authenticates deliveries with, so a keyless instance would let anyone
   * holding a database copy forge deliveries that verify. Only the write fails, never boot, and rows
   * already in the clear keep signing until the boot migration encrypts them.
   */
  private encryptSecretForStorage(secret: string): string {
    if (!isEncryptionAvailable()) {
      throw new HttpException(
        'CREDENTIALS_ENCRYPTION_KEY is not configured on this server — a webhook secret cannot be ' +
          'stored, because it would have to be written unencrypted. Set it (see utils/secret-crypto.ts) ' +
          'and retry; a webhook with no secret can still be created without it.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return encryptJson(secret);
  }

  /**
   * Legacy plaintext is used as-is; an encrypted blob whose key is now missing (rotated or
   * misconfigured) is sent unsigned, since signing the ciphertext would produce an unverifiable
   * signature.
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

    return webhooks.map((w) => ({ ...w, secret: undefined }));
  }

  /**
   * Returns the full row with `secret` back in plaintext: the one-time reveal the settings screen
   * shows after creation. Every other read strips the column.
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

    // Only encrypt a newly set secret: re-encrypting the stored blob would make it undecryptable.
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

  /** Sends to every given webhook in parallel, HMAC-signed when a secret is resolvable. */
  async send(webhooks: Webhook[], event: WebhookEvent, payload: any) {
    // Demo instance: the one chokepoint every dispatch reaches, checked before any network attempt.
    assertDemoSendingAllowed('Webhook delivery');

    const results = await Promise.all(
      webhooks.map(async (webhook) => {
        // Re-validate at send time (DNS rebinding) and keep the resolved address, so the driver pins
        // it instead of letting `fetch` resolve the hostname again. A webhook failing this is
        // skipped, never aborting the batch.
        let resolved: ResolvedOutboundUrl | null;
        try {
          resolved = await assertPublicWebhookUrl(webhook.url);
        } catch (err) {
          // Never the reason: see `validateWebhookUrl`.
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
