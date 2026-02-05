import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { logger } from '@/logger/logger.service';
import type { IWebhookProvider } from '@/plugins/types';
import prisma from '@/prisma/prisma.service';
import type { Webhook, WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';
import { PluginsService } from '../plugins/plugins.service';
import { DiscordDriver } from './drivers/discord.driver';
import { GenericDriver } from './drivers/generic.driver';
import { MattermostDriver } from './drivers/mattermost.driver';
import { RocketChatDriver } from './drivers/rocketchat.driver';
import { SlackDriver } from './drivers/slack.driver';
import { TeamsDriver } from './drivers/teams.driver';
import type { WebhookDriver } from './drivers/webhook-driver.interface';
import { ZapierDriver } from './drivers/zapier.driver';

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
    logger.info(`Processing webhook for plugin: ${pluginId}`, {
      category: 'webhook',
      details: { pluginId },
    });
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
    const provider = await this.pluginsService.getProviderByType<IWebhookProvider>(
      plugin.type.toLowerCase(),
    );

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
      this.logger.warn(
        `No webhook driver found for type: ${type}, using GenericDriver as fallback`,
      );
      return new GenericDriver();
    }
    return driver;
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
