import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import prisma from "@/prisma/prisma.service";
import { PluginType } from "../../prisma/generated/prisma/client";
import { DocumensoProvider } from "./signing/providers/documenso/documenso";
import { IPluginForm } from "./signing/types";
import { LocalStorageProvider } from "./storage/providers/local/local";
import { S3StorageProvider } from "./storage/providers/s3/s3";

export class PluginRegistry {
  private readonly logger: Logger = new Logger(PluginRegistry.name);
  private static instance: PluginRegistry;
  private readonly inAppPluginTypes = new Map<PluginType, Map<string, { name?: string }>>();
  private readonly providersMap = new Map<string, { name?: string }>();
  private static isInitialized = false;
  private static initializationPromise: Promise<void> | null = null;
  public static readonly multiInstancePluginTypes: Set<PluginType> = new Set([PluginType.STORAGE]);

  private constructor() {}

  static getInstance(): PluginRegistry {
    if (!PluginRegistry.instance) {
      PluginRegistry.instance = new PluginRegistry();
    }
    return PluginRegistry.instance;
  }

  async initializeIfNeeded(): Promise<void> {
    if (PluginRegistry.isInitialized) {
      return;
    }

    if (PluginRegistry.initializationPromise) {
      await PluginRegistry.initializationPromise;
      return;
    }

    // Démarrer l'initialisation
    PluginRegistry.initializationPromise = this.doInitialization();
    await PluginRegistry.initializationPromise;
  }

  private async doInitialization(): Promise<void> {
    if (PluginRegistry.isInitialized) {
      return;
    }

    this.initializeInAppPlugins();
    await this.syncWithDatabase();
    PluginRegistry.isInitialized = true;
    PluginRegistry.initializationPromise = null;
  }

  private initializeInAppPlugins() {
    this.removeRemovedProviders();
    this.registerProvider(PluginType.SIGNING, new DocumensoProvider());
    this.registerProvider(PluginType.STORAGE, new S3StorageProvider());
    this.registerProvider(PluginType.STORAGE, new LocalStorageProvider());
  }

  private removeRemovedProviders() {
    prisma.plugin.findMany().then((plugins) => {
      plugins.forEach((plugin) => {
        if (!this.providersMap.has(plugin.id)) {
          prisma.plugin
            .delete({ where: { id: plugin.id } })
            .then(() => {
              this.logger.log(
                `Removed plugin "${plugin.id}" from database as it is no longer registered.`,
              );
            })
            .catch((err) => {
              this.logger.error(`Error removing plugin "${plugin.id}":`, err);
            });
        }
      });
    });
  }

  private registerProvider(
    type: PluginType,
    provider: { id: string; name: string; form?: IPluginForm },
  ) {
    if (!this.inAppPluginTypes.has(type)) {
      this.inAppPluginTypes.set(type, new Map());
    }

    if (provider?.id) {
      const form = provider.form || {};
      this.inAppPluginTypes.get(type)?.set(provider.id, form);
      this.providersMap.set(provider.id, provider);
      this.logger.log(`Registered ${type} provider: ${provider.id}`);
    }
  }

  private async syncWithDatabase(): Promise<void> {
    for (const [type, providers] of this.inAppPluginTypes) {
      const pluginType = this.getPluginTypeEnum(type);

      for (const [providerId, _form] of providers) {
        const existingPlugin = await prisma.plugin.findUnique({
          where: {
            id: providerId,
          },
        });

        if (!existingPlugin) {
          await prisma.plugin.create({
            data: {
              id: providerId,
              name: this.providersMap.get(providerId)?.name || providerId,
              type: pluginType,
              config: {},
              isActive: false,
            },
          });
          this.logger.log(`Synced ${type} provider "${providerId}" to database`);
        }
      }
    }
  }

  private getPluginTypeEnum(type: string): PluginType {
    switch (type.toLowerCase()) {
      case "signing":
        return PluginType.SIGNING;
      case "storage":
        return PluginType.STORAGE;
      default:
        throw new Error(`Unknown plugin type: ${type}`);
    }
  }

  async getProvidersByType<T>(type: string): Promise<T[]> {
    await this.initializeIfNeeded();

    const results = await Promise.all(
      Array.from(this.providersMap.entries()).map(async ([pluginId, provider]) => {
        const plugin = await prisma.plugin.findFirst({
          where: {
            id: pluginId,
            isActive: true,
          },
        });
        if (!plugin || plugin.type.toLowerCase() !== type.toLowerCase()) {
          return null;
        }
        return [pluginId, provider];
      }),
    );

    const pluginEntries = results.filter(
      (entry): entry is [string, { name: string }] => entry !== null,
    );

    return pluginEntries.map(([_, provider]) => provider as T);
  }

  async getProviderByType<T>(type: string): Promise<T | null> {
    await this.initializeIfNeeded();

    const results = await Promise.all(
      Array.from(this.providersMap.entries()).map(async ([pluginId, provider]) => {
        const plugin = await prisma.plugin.findFirst({
          where: {
            id: pluginId,
            isActive: true,
          },
        });
        if (!plugin || plugin.type.toLowerCase() !== type.toLowerCase()) {
          return null;
        }
        return [pluginId, provider];
      }),
    );

    const pluginEntries = results.filter(
      (entry): entry is [string, { name: string }] => entry !== null,
    );

    if (pluginEntries.length === 0) {
      return null;
    }

    return pluginEntries[0][1] as T;
  }

  async getProvider<T>(id: string): Promise<T | null> {
    await this.initializeIfNeeded();

    const plugin = await prisma.plugin.findFirst({
      where: {
        id,
        isActive: true,
      },
    });

    if (!plugin) {
      return null;
    }

    return (this.providersMap.get(plugin.id) as T) || null;
  }

  public async getProviderForm(plugin_id: string): Promise<IPluginForm> {
    let path: string = "";
    for (const [type, providers] of this.inAppPluginTypes) {
      if (providers.has(plugin_id)) {
        path = join(
          process.cwd(),
          "src",
          "plugins",
          type.toLowerCase(),
          "providers",
          plugin_id,
          `${plugin_id}-form.json`,
        );
        break;
      }
    }

    path = path.replace("src/src", "src");

    if (!path || !existsSync(path)) {
      await prisma.plugin.delete({ where: { id: plugin_id } });
      throw new Error(`Form for plugin ID "${plugin_id}" not found.`);
    }

    const content = JSON.parse(readFileSync(path, "utf-8")) as IPluginForm;
    return content;
  }
}
