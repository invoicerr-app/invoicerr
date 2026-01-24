import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { simpleGit } from 'simple-git';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { generateWebhookSecret } from '@/utils/webhook-security';
import { PluginRegistry } from '../../plugins';

export interface PdfFormatInfo {
  format_name: string;
  format_key: string;
}

export interface IPlugin {
  __uuid: string;
  __filepath: string;
  name: string;
  description: string;
  init?: () => void;
  config?: any;
  type?: string;
  isActive?: boolean;
}

const PLUGIN_DIR = process.env.PLUGIN_DIR || '/root/invoicerr-plugins';
const PLUGIN_DIRS = [PLUGIN_DIR, join(process.cwd(), 'src', 'in-app-plugins')];

@Injectable()
export class PluginsService {
  private readonly plugins: IPlugin[] = [];
  private pluginRegistry = PluginRegistry.getInstance();
  private static isInitialized = false;

  constructor() {
    if (!PluginsService.isInitialized) {
      logger.info('Loading plugins...', { category: 'plugin' });
      this.loadExistingPlugins();

      this.pluginRegistry.initializeIfNeeded().catch((err) => {
        logger.error('Failed to initialize plugin registry', {
          category: 'plugin',
          details: { error: err },
        });
      });
      PluginsService.isInitialized = true;
    }
  }

  async cloneRepo(gitUrl: string, name: string): Promise<string> {
    const pluginPath = join(PLUGIN_DIR, name);

    if (!existsSync(pluginPath)) {
      logger.info(`Cloning plugin "${name}" from ${gitUrl}...`, { category: 'plugin' });
      await simpleGit().clone(gitUrl, pluginPath);
    }

    return pluginPath;
  }

  async loadExistingPlugins(): Promise<void> {
    for (const pluginDir of PLUGIN_DIRS) {
      logger.info(`Loading plugins from directory: ${pluginDir}`, { category: 'plugin' });
      if (!existsSync(pluginDir)) {
        logger.warn(`Plugin directory "${pluginDir}" does not exist.`, { category: 'plugin' });
        return;
      }

      const dirs = readdirSync(pluginDir).filter((f) => statSync(join(pluginDir, f)).isDirectory());

      for (const dir of dirs) {
        try {
          await this.loadPluginFromPath(join(pluginDir, dir));
        } catch (err) {
          logger.error(`Failed to load plugin "${dir}"`, {
            category: 'plugin',
            details: { error: err.message },
          });
        }
      }
    }
  }

  async loadPluginFromPath(pluginPath: string): Promise<IPlugin> {
    if (pluginPath.startsWith('http')) {
      pluginPath = await this.cloneRepo(
        pluginPath,
        pluginPath.split('/').pop() || `unknown-plugin-${Date.now()}`,
      );
    }
    const files = readdirSync(pluginPath);
    const jsFile = files.find((f) => extname(f) === '.js');
    if (!jsFile) {
      logger.error(`No .js file found in plugin directory: ${pluginPath}`, {
        category: 'plugin',
        details: { pluginPath },
      });
      throw new Error(`No .js file found in plugin directory: ${pluginPath}`);
    }
    const pluginFile = join(pluginPath, jsFile);
    const pluginModule = await import(pluginFile);
    const PluginClass = pluginModule.default;
    const plugin: IPlugin = new PluginClass();
    plugin.init?.();
    let uuid = randomUUID();
    while (this.plugins.some((p) => p.__uuid === uuid)) {
      uuid = randomUUID();
    }
    plugin.__uuid = uuid;
    plugin.__filepath = pluginFile;
    this.plugins.push(plugin);
    logger.info(`Plugin "${plugin.name}" loaded.`, {
      category: 'plugin',
      details: { pluginName: plugin.name },
    });
    return plugin;
  }

  async loadAllPlugins(pluginConfigs: { git: string; name: string }[]) {
    for (const config of pluginConfigs) {
      try {
        const path = await this.cloneRepo(config.git, config.name);
        await this.loadPluginFromPath(path);
      } catch (err) {
        logger.error(`Failed to load plugin "${config.name}"`, {
          category: 'plugin',
          details: { error: err.message },
        });
      }
    }
  }

  getPlugins(): IPlugin[] {
    return this.plugins;
  }

  async getInAppPlugins(): Promise<
    {
      category: string;
      plugins: { name: string; isActive: boolean; id: string; hasWebhook: boolean }[];
    }[]
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

  async getActivePlugin(id: string): Promise<IPlugin | null> {
    const dbProvider = await prisma.plugin.findFirst({
      where: {
        id,
        isActive: true,
      },
    });

    if (!dbProvider) {
      return null;
    }
    const provider = await this.pluginRegistry.getProvider(id);

    if (!provider) {
      return null;
    }

    const pluginType = this.getPluginTypeEnum(dbProvider.type);
    const activePlugin = await prisma.plugin.findFirst({
      where: {
        type: pluginType as any,
        isActive: true,
      },
    });

    if (!activePlugin) {
      return null;
    }

    const inAppPlugin: IPlugin = {
      __uuid: activePlugin.id,
      __filepath: '',
      name: activePlugin.name,
      description: `Plugin ${activePlugin.name} de type ${activePlugin.type}`,
      config: activePlugin.config,
      type: activePlugin.type,
      isActive: activePlugin.isActive,
      ...provider,
    };

    return inAppPlugin;
  }

  /**
   * Get the active provider for a given type
   * @param type The plugin type (signing, payment, etc.)
   * @returns The active provider or null
   */
  async getProviderByType<T = IPlugin>(type: string): Promise<T | null> {
    return await this.pluginRegistry.getProviderByType<T>(type);
  }

  /**
   * Get all active providers for a given type
   * @param type The plugin type (signing, payment, etc.)
   * @returns Array of active providers
   */
  async getProvidersByType<T = IPlugin>(type: string): Promise<T[]> {
    return await this.pluginRegistry.getProvidersByType<T>(type);
  }

  /**
   * Get the active provider by its ID
   * @param id The plugin ID
   * @returns The active provider or null
   */
  async getProviderById<T = IPlugin>(id: string): Promise<T | null> {
    return await this.pluginRegistry.getProvider<T>(id);
  }

  private getPluginTypeEnum(type: string): string {
    switch (type.toLowerCase()) {
      case 'signing':
        return 'SIGNING';
      case 'pdf_format':
        return 'PDF_FORMAT';
      case 'payment':
        return 'PAYMENT';
      case 'oidc':
        return 'OIDC';
      default:
        logger.error(`Unknown plugin type: ${type}`, { category: 'plugin', details: { type } });
        throw new Error(`Unknown plugin type: ${type}`);
    }
  }

  canGenerateXml(_format: string): boolean {
    // Check if a_formatgin can generate the requested XML format
    // For now, return false
    return false;
  }

  async generateXml(format: string, _xmlInvoice: any): Promise<string> {
    // Return XML using a plugin_xmlInvoice
    // For now, throw an error as this feature is not yet implemented
    logger.error(`XML generation for format "${format}" not implemented yet`, {
      category: 'plugin',
      details: { format },
    });
    throw new Error(`XML generation for format "${format}" not implemented yet`);
  }

  getFormats(): any[] {
    // Return formats provided by plugins
    // For now, return an empty array
    return [];
  }

  async deletePlugin(uuid: string): Promise<boolean> {
    const index = this.plugins.findIndex((p) => p.__uuid === uuid);
    if (index === -1) {
      logger.error(`Plugin with UUID "${uuid}" not found`, {
        category: 'plugin',
        details: { uuid },
      });
      throw new Error(`Plugin with UUID "${uuid}" not found`);
    }
    const plugin = this.plugins[index];
    this.plugins.splice(index, 1);
    if (existsSync(plugin.__filepath)) {
      let pluginDir = plugin.__filepath;
      pluginDir = join(pluginDir, '..');
      logger.info(`Deleting plugin files at ${pluginDir}`, {
        category: 'plugin',
        details: { pluginName: plugin.name },
      });
      rmSync(pluginDir, { recursive: true, force: true });
    }
    logger.info(`Plugin "${plugin.name}" deleted.`, {
      category: 'plugin',
      details: { pluginName: plugin.name },
    });

    return true;
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
      logger.info(
        `Plugin ${plugin.name} does not support webhooks (handleWebhook method not found)`,
        { category: 'plugin', details: { pluginName: plugin.name } },
      );
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

    return {
      ...(webhookUrl && { webhookUrl }),
      ...(webhookSecret && { webhookSecret }),
      instructions,
    };
  }

  /**
   * Generate specific instructions to configure webhooks based on plugin type
   * @returns Instructions as an array of strings
   */
  private generatePluginInstructions(
    plugin: any,
    webhookUrl?: string,
    webhookSecret?: string,
  ): string[] {
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

    instructions.forEach((instruction) => {
      logger.info(instruction, { category: 'plugin' });
    });

    return instructions;
  }
}
