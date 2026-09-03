/**
 * TODO_SUITE.md P2 (2026-09-03) — the external, git-clone plugin mechanism (`POST /api/plugins`,
 * `GET /api/plugins`, `GET /api/plugins/formats`, `DELETE /api/plugins`, and everything behind
 * them in `PluginsService`: `cloneRepo`/`loadPluginFromPath`/`loadExistingPlugins`/
 * `loadAllPlugins`/`getPlugins`/`deletePlugin`/`canGenerateXml`/`generateXml`/`getFormats`, and the
 * `IPlugin`/`InvoicePlugin`/`PdfFormatInfo` types that shaped it) was REMOVED (decision recorded in
 * TODO_ISSUES.md, "Le système de plugins, vu par son premier vrai consommateur", T5c). This is a
 * removal of behavior, not a weakened test: no spec exercised that mechanism before this task (grep
 * found none), so there is nothing to "port" — this file's job is the OPPOSITE direction, proving
 * the OTHER, unrelated mechanism this same controller/service always also carried — in-app plugins
 * (`PluginRegistry`/`PluginType`, the `Plugin` Postgres table, the Settings > Plugins screen) —
 * survived the cut intact, and that no ghost route answers the removed paths any more.
 *
 * `@/prisma/prisma.service` and the in-app `PluginRegistry` singleton (`../../plugins`) are both
 * mocked at their own entry points — the same isolation discipline `channels.service.spec.ts`
 * already holds — so this proves the CONTROLLER→SERVICE wiring and the service's own in-app logic,
 * never a real database or the real S3/local/Documenso providers.
 */
const mockRegistry = {
  getProviderForm: jest.fn(),
  getProvider: jest.fn(),
  getProviderByType: jest.fn(),
  getProvidersByType: jest.fn(),
  initializeIfNeeded: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../plugins', () => ({
  PluginRegistry: {
    getInstance: jest.fn(() => mockRegistry),
    multiInstancePluginTypes: new Set(['STORAGE']),
  },
}));

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    plugin: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    // logger.service.ts writes every log line through prisma.log.create() — stubbed so its
    // own internal try/catch doesn't spam stderr for a model this spec has no interest in.
    log: { create: jest.fn().mockResolvedValue({}) },
  },
}));

import prisma from '@/prisma/prisma.service';
import { PluginsController } from './plugins.controller';
import { PluginsService } from './plugins.service';

const mockedPrisma = prisma as unknown as {
  plugin: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
};

describe('Plugins — the in-app mechanism survives the external mechanism removal (P2)', () => {
  let controller: PluginsController;
  let service: PluginsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistry.initializeIfNeeded.mockResolvedValue(undefined);
    service = new PluginsService();
    controller = new PluginsController(service);
  });

  describe('the four surviving routes are GENUINELY ROUTED — path metadata pinned (validation P2 tripwire)', () => {
    /** Added by the P2 VALIDATION pass (2026-09-03): stripping `@Get('in-app')` off the controller
     *  left this whole suite green — the tests call the methods directly, so a method that silently
     *  stopped being a ROUTE was invisible. Nest stores the route path under the 'path' metadata
     *  key on the method: pinning it here makes "still a route, at the expected path" a tested
     *  fact, not an assumption. */
    it.each([
      ['getInAppPlugins', 'in-app'],
      ['toggleInAppPlugin', 'in-app/toggle'],
      ['configureInAppPlugin', 'in-app/configure'],
      ['validatePlugin', 'in-app/validate'],
    ])('%s is routed at "%s"', (method, path) => {
      const handler = (PluginsController.prototype as unknown as Record<string, unknown>)[method] as object;
      expect(handler).toBeDefined();
      expect(Reflect.getMetadata('path', handler)).toBe(path);
    });
  });

  describe('no ghost route: the removed endpoints answer nowhere', () => {
    it('the controller exposes ONLY the in-app routes', () => {
      const methodNames = Object.getOwnPropertyNames(PluginsController.prototype).filter(
        (name) => name !== 'constructor',
      );

      expect(methodNames.sort()).toEqual(
        ['getInAppPlugins', 'toggleInAppPlugin', 'configureInAppPlugin', 'validatePlugin'].sort(),
      );

      // The external surface named in TODO_ISSUES.md — none of it survives as a callable method.
      for (const ghost of ['getPlugins', 'getFormats', 'addPlugin', 'deletePlugin']) {
        expect((controller as any)[ghost]).toBeUndefined();
      }
    });

    it('the service exposes no external-plugin machinery any more', () => {
      for (const ghost of [
        'cloneRepo',
        'loadPluginFromPath',
        'loadExistingPlugins',
        'loadAllPlugins',
        'getPlugins',
        'deletePlugin',
        'canGenerateXml',
        'generateXml',
        'getFormats',
        'getActivePlugin',
      ]) {
        expect((service as any)[ghost]).toBeUndefined();
      }
    });
  });

  describe('GET /plugins/in-app — the settings screen categories', () => {
    it('groups plugins by type, exactly as the screen expects', async () => {
      mockedPrisma.plugin.findMany.mockImplementation((args: any) => {
        if (args?.distinct) return Promise.resolve([{ type: 'STORAGE' }]);
        return Promise.resolve([
          { id: 's3', name: 'S3', isActive: true, webhookUrl: null },
          { id: 'local', name: 'Local disk', isActive: false, webhookUrl: 'https://app/api/webhooks/local' },
        ]);
      });

      const result = await controller.getInAppPlugins();

      expect(result).toEqual([
        {
          category: 'Storage',
          plugins: [
            { id: 's3', name: 'S3', isActive: true, hasWebhook: false },
            { id: 'local', name: 'Local disk', isActive: false, hasWebhook: true },
          ],
        },
      ]);
    });
  });

  describe('PUT /plugins/in-app/toggle — activate/deactivate', () => {
    it('deactivating clears the webhook config', async () => {
      mockedPrisma.plugin.findFirst.mockResolvedValueOnce({
        id: 's3',
        name: 'S3',
        type: 'STORAGE',
        isActive: true,
      });

      const result = await controller.toggleInAppPlugin({ pluginId: 's3' });

      expect(result).toEqual({ success: true });
      expect(mockedPrisma.plugin.update).toHaveBeenCalledWith({
        where: { id: 's3' },
        data: { isActive: false, webhookUrl: null, webhookSecret: null },
      });
    });

    it('activating a plugin that needs configuration defers activation and returns the form', async () => {
      mockedPrisma.plugin.findFirst
        .mockResolvedValueOnce({ id: 's3', name: 'S3', type: 'STORAGE', isActive: false, config: {} })
        .mockResolvedValueOnce(null); // no other active plugin of the same type
      mockRegistry.getProviderForm.mockResolvedValueOnce({ form: { fields: [{ name: 'bucket' }] } });

      const result = await controller.toggleInAppPlugin({ pluginId: 's3' });

      expect(result).toEqual({
        requiresConfiguration: true,
        formConfig: { form: { fields: [{ name: 'bucket' }] } },
        currentConfig: {},
      });
      expect(mockedPrisma.plugin.update).not.toHaveBeenCalled();
    });
  });

  describe('POST /plugins/in-app/validate — webhook provisioning', () => {
    it('generates and persists a webhook URL/secret when the provider implements handleWebhook', async () => {
      mockedPrisma.plugin.findFirst.mockResolvedValueOnce({
        id: 'documenso',
        name: 'Documenso',
        type: 'SIGNING',
        config: {},
      });
      mockRegistry.getProvider.mockResolvedValueOnce({ handleWebhook: jest.fn() });

      const result = await controller.validatePlugin({ pluginId: 'documenso' });

      expect(result.success).toBe(true);
      expect(result.webhookUrl).toMatch(/\/api\/webhooks\/documenso$/);
      expect(result.webhookSecret).toEqual(expect.any(String));
      expect(mockedPrisma.plugin.update).toHaveBeenCalledWith({
        where: { id: 'documenso' },
        data: { webhookUrl: result.webhookUrl, webhookSecret: result.webhookSecret },
      });
    });
  });
});
