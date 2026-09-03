import { BadRequestException, Injectable } from '@nestjs/common';

import { PluginRegistry } from '../../plugins';
import { generateWebhookSecret } from '@/utils/webhook-security';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

// TODO_SUITE.md P2 (2026-09-03) — this service used to ALSO run a second, entirely separate
// mechanism: git-clone-and-dynamic-`import()` "external" plugins (POST /api/plugins, an in-memory
// `IPlugin[]` array, a `PLUGIN_DIR` on disk). It was removed: `IPlugin` there was `{__uuid,
// __filepath, name, description}` with NO real extension point behind it — the two generic
// consumers a caller could reach (`canGenerateXml`/`generateXml`) were permanent stubs (`return
// false` / `throw`), so an external plugin, once loaded, could do nothing. See TODO_ISSUES.md,
// "Le système de plugins, vu par son premier vrai consommateur" (T5c) for the full account and the
// decision: extensibility is the narrow-interface-at-the-core pattern (this task's own OCR/Mistral
// plugin, `plugins/ocr/providers/mistral/mistral.ts`), not third-party code loading. Everything
// below is the OTHER mechanism, which this service always also ran: IN-APP plugins
// (`PluginRegistry`/`PluginType`, the `Plugin` Postgres table, the Settings > Plugins screen) —
// unaffected by the removal.
@Injectable()
export class PluginsService {
  private pluginRegistry = PluginRegistry.getInstance();
  private static isInitialized = false;

  constructor() {
    if (!PluginsService.isInitialized) {
      logger.info('Loading plugins...', { category: 'plugin' });

      this.pluginRegistry.initializeIfNeeded().catch((err) => {
        logger.error('Failed to initialize plugin registry', { category: 'plugin', details: { error: err } });
      });
      PluginsService.isInitialized = true;
    }
  }

  async getInAppPlugins(): Promise<
    { category: string; plugins: { name: string; isActive: boolean; id: string; hasWebhook: boolean }[] }[]
  > {
    const categories = await prisma.plugin.findMany({
      select: { type: true },
      distinct: ['type'],
    });

    const result: {
      category: string;
      plugins: { id: string; name: string; isActive: boolean; hasWebhook: boolean }[];
    }[] = [];

    for (const category of categories) {
      const pluginsInCategory = await prisma.plugin.findMany({
        where: { type: category.type },
        select: { id: true, name: true, isActive: true, webhookUrl: true },
      });

      const title = category.type.toLowerCase();

      result.push({
        category: title.charAt(0).toUpperCase() + title.slice(1),
        plugins: pluginsInCategory.map((p) => ({
          id: p.id,
          name: p.name,
          isActive: p.isActive,
          hasWebhook: p.webhookUrl !== null,
        })),
      });
    }

    return result;
  }

  async toggleInAppPlugin(id: string) {
    const plugin = await prisma.plugin.findFirst({
      where: { id },
    });

    if (!plugin) {
      logger.error(`Plugin with id "${id}" not found`, { category: 'plugin', details: { id } });
      throw new Error(`Plugin with id "${id}" not found`);
    }

    if (plugin.isActive) {
      await prisma.plugin.update({
        where: { id },
        data: { isActive: false, webhookUrl: null, webhookSecret: null },
      });
      logger.info(`Plugin "${plugin.name}" is now inactive.`, {
        category: 'plugin',
        details: { pluginName: plugin.name },
      });
      return { success: true };
    }

    const existingActivePlugin = await prisma.plugin.findFirst({
      where: {
        type: plugin.type,
        isActive: true,
        id: { not: plugin.id },
      },
    });

    if (existingActivePlugin && !PluginRegistry.multiInstancePluginTypes.has(plugin.type)) {
      logger.error(
        `Another plugin "${existingActivePlugin.name}" is already active for category "${plugin.type}". Please disable it first.`,
        { category: 'plugin', details: { pluginType: plugin.type } },
      );
      throw new BadRequestException(
        `Another plugin "${existingActivePlugin.name}" is already active for category "${plugin.type}". Please disable it first.`,
      );
    }

    const formConfig = await this.pluginRegistry.getProviderForm(plugin.id);

    if (formConfig && Object.keys(formConfig).length > 0) {
      return {
        requiresConfiguration: true,
        formConfig: formConfig,
        currentConfig: plugin.config || {},
      };
    }

    await prisma.plugin.update({
      where: { id },
      data: { isActive: true },
    });
    logger.info(`Plugin "${plugin.name}" is now active.`, {
      category: 'plugin',
      details: { pluginName: plugin.name },
    });

    const validation = await this.pluginValidation(id);

    return {
      success: true,
      ...(validation.webhookUrl && { webhookUrl: validation.webhookUrl }),
      ...(validation.webhookSecret && { webhookSecret: validation.webhookSecret }),
      instructions: validation.instructions,
    };
  }

  async configureInAppPlugin(id: string, config: Record<string, any>) {
    const plugin = await prisma.plugin.findFirst({
      where: { id },
    });

    if (!plugin) {
      logger.error(`Plugin with id "${id}" not found`, { category: 'plugin', details: { id } });
      throw new BadRequestException(`Plugin with id "${id}" not found`);
    }

    const existingActivePlugin = await prisma.plugin.findFirst({
      where: {
        type: plugin.type,
        isActive: true,
        id: { not: plugin.id },
      },
    });

    if (existingActivePlugin) {
      logger.error(
        `Another plugin "${existingActivePlugin.name}" is already active for category "${plugin.type}". Please disable it first.`,
        { category: 'plugin', details: { pluginType: plugin.type } },
      );
      throw new BadRequestException(
        `Another plugin "${existingActivePlugin.name}" is already active for category "${plugin.type}". Please disable it first.`,
      );
    }

    await prisma.plugin.update({
      where: { id },
      data: {
        config: config,
        isActive: true,
      },
    });
    logger.info(`Plugin "${plugin.name}" configured and activated.`, {
      category: 'plugin',
      details: { pluginName: plugin.name },
    });

    const validation = await this.pluginValidation(id);

    return {
      success: true,
      ...(validation.webhookUrl && { webhookUrl: validation.webhookUrl }),
      ...(validation.webhookSecret && { webhookSecret: validation.webhookSecret }),
      instructions: validation.instructions,
    };
  }

  /**
   * Get the active provider for a given type
   * @param type The plugin type (signing, payment, etc.)
   * @returns The active provider or null
   */
  async getProviderByType<T>(type: string): Promise<T | null> {
    return await this.pluginRegistry.getProviderByType<T>(type);
  }

  /**
   * Get all active providers for a given type
   * @param type The plugin type (signing, payment, etc.)
   * @returns Array of active providers
   */
  async getProvidersByType<T>(type: string): Promise<T[]> {
    return await this.pluginRegistry.getProvidersByType<T>(type);
  }

  /**
   * Validate a plugin and configure its webhook (only if the provider implements handleWebhook)
   * @param pluginId The ID of the plugin to validate
   * @returns Instructions for configuring the webhook with the secret (only if webhook is supported)
   */
  async pluginValidation(
    pluginId: string,
  ): Promise<{ webhookUrl?: string; webhookSecret?: string; instructions: string[] }> {
    const plugin = await prisma.plugin.findFirst({
      where: { id: pluginId, isActive: true },
    });

    if (!plugin) {
      logger.error(`Active plugin with id "${pluginId}" not found`, {
        category: 'plugin',
        details: { pluginId },
      });
      throw new BadRequestException(`Active plugin with id "${pluginId}" not found`);
    }
    logger.info(`Validating plugin: ${plugin.name} (${plugin.type})`, {
      category: 'plugin',
      details: { pluginName: plugin.name, pluginType: plugin.type },
    });

    // Get the provider to check if it implements handleWebhook
    const provider = await this.pluginRegistry.getProvider<any>(plugin.type.toLowerCase());

    let webhookUrl: string | undefined;
    let webhookSecret: string | undefined;

    // Only configure webhook if the provider implements handleWebhook
    if (provider && typeof provider.handleWebhook === 'function') {
      logger.info(`Plugin ${plugin.name} supports webhooks (handleWebhook method found)`, {
        category: 'plugin',
        details: { pluginName: plugin.name },
      });

      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      webhookUrl = `${baseUrl}/api/webhooks/${plugin.id}`;
      webhookSecret = generateWebhookSecret();

      await prisma.plugin.update({
        where: { id: plugin.id },
        data: {
          webhookUrl,
          webhookSecret,
        },
      });
      logger.info(`Generated webhook URL for plugin ${plugin.name}: ${webhookUrl}`, {
        category: 'plugin',
        details: { pluginName: plugin.name, webhookUrl },
      });
      logger.info(`Generated webhook secret for plugin ${plugin.name}`, {
        category: 'plugin',
        details: { pluginName: plugin.name },
      });
    } else {
      logger.info(`Plugin ${plugin.name} does not support webhooks (handleWebhook method not found)`, {
        category: 'plugin',
        details: { pluginName: plugin.name },
      });
      // Clear webhook configuration if provider doesn't support it
      await prisma.plugin.update({
        where: { id: plugin.id },
        data: {
          webhookUrl: null,
          webhookSecret: null,
        },
      });
    }

    // Validate plugin configuration using validatePlugin if available
    if (provider && typeof provider.validatePlugin === 'function') {
      try {
        await provider.validatePlugin(plugin.config);
        logger.info(`Plugin ${plugin.name} validated successfully by provider`, {
          category: 'plugin',
          details: { pluginName: plugin.name },
        });
      } catch (error) {
        logger.error(`Provider validation failed for plugin ${plugin.name}`, {
          category: 'plugin',
          details: { pluginName: plugin.name, error },
        });
        throw new BadRequestException(`Plugin validation failed: ${error.message}`);
      }
    }

    const instructions = this.generatePluginInstructions(plugin, webhookUrl, webhookSecret);

    return { ...(webhookUrl && { webhookUrl }), ...(webhookSecret && { webhookSecret }), instructions };
  }

  /**
   * Generate specific instructions to configure webhooks based on plugin type
   * @returns Instructions as an array of strings
   */
  private generatePluginInstructions(plugin: any, webhookUrl?: string, webhookSecret?: string): string[] {
    const instructions: string[] = [];

    // Only generate webhook-related instructions if webhooks are supported
    if (!webhookUrl || !webhookSecret) {
      logger.info(`No webhook configuration for plugin ${plugin.name}`, {
        category: 'plugin',
        details: { pluginName: plugin.name },
      });
      return instructions;
    }

    switch (plugin.type.toLowerCase()) {
      case 'signing':
        if (plugin.id === 'documenso') {
          instructions.push('webhook.instructions.documenso.title');
          instructions.push('webhook.instructions.documenso.step1');
          instructions.push('webhook.instructions.documenso.step2');
          instructions.push('webhook.instructions.documenso.step3');
          instructions.push('webhook.instructions.documenso.step4');
          instructions.push('webhook.instructions.documenso.step5');
        } else if (plugin.id === 'docuseal') {
          // TODO: Add instructions for DocuSeal when implemented
        }
        break;

      default:
        break;
    }

    for (const instruction of instructions) logger.info(instruction, { category: 'plugin' });

    return instructions;
  }
}
