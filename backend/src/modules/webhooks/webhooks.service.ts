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
import { ZapierDriver } from './drivers/zapier.driver';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

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
    // Vérifier que le plugin existe et est actif
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

    // Récupérer le provider du plugin
    const provider = await this.pluginsService.getProviderByType<IWebhookProvider>(plugin.type.toLowerCase());

    if (!provider) {
      logger.warn(`No provider found for plugin type: ${plugin.type}`, {
        category: 'webhook',
        details: { pluginType: plugin.type },
      });
      throw new NotFoundException(`No provider found for plugin type: ${plugin.type}`);
    }

    // Vérifier que le provider a une méthode handleWebhook
    if (typeof provider.handleWebhook !== 'function') {
      logger.warn(`Provider for plugin ${plugin.name} does not implement handleWebhook method`, {
        category: 'webhook',
        details: { pluginName: plugin.name },
      });
      return { message: 'Webhook received but not handled by provider' };
    }

    // Appeler la méthode handleWebhook du provider
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
   * Generate a webhook URL for a given plugin ID
   */
  generateWebhookUrl(pluginId: string): string {
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    return `${baseUrl}/api/webhooks/${pluginId}`;
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

  /** Create a webhook for the active company. Returns the full row (incl. secret) + company for event dispatch. */
  async create(companyId: string, body: WebhookCreateInput) {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    const secret = body.secret ?? '';

    const webhook = await prisma.webhook.create({
      data: {
        url: body.url,
        type: body.type ?? 'GENERIC',
        events: body.events ?? [],
        secret,
        companyId,
      },
    });

    return { webhook, company };
  }

  /** Update a webhook (company-scoped, 404 otherwise). Returns the full updated row + company for event dispatch. */
  async update(companyId: string, id: string, body: WebhookUpdateInput) {
    const existing = await prisma.webhook.findFirst({ where: { id, companyId } });
    if (!existing) throw new HttpException('Webhook not found', HttpStatus.NOT_FOUND);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    const webhook = await prisma.webhook.update({
      where: { id },
      data: {
        url: body.url ?? existing.url,
        type: body.type ?? existing.type,
        events: body.events ?? existing.events,
        secret: body.secret ?? existing.secret,
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
        const driver = this.getDriver(webhook.type);
        return await driver.send(
          webhook.url,
          {
            event,
            ...payload,
          },
          webhook.secret ?? null,
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
