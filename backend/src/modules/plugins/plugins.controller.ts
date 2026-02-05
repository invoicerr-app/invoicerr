import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { PluginsService } from '@/modules/plugins/plugins.service';

@Controller('plugins')
export class PluginsController {
  constructor(private readonly pluginsService: PluginsService) {}

  @Get()
  async getPlugins() {
    return this.pluginsService.getPlugins().map((plugin) => ({
      uuid: plugin.__uuid,
      name: plugin.name,
      description: plugin.description,
    }));
  }

  @Get('formats')
  async getFormats() {
    return this.pluginsService.getFormats();
  }

  @Post()
  async addPlugin(@Body() body: { gitUrl: string }) {
    const { gitUrl } = body;
    if (!gitUrl) {
      throw new Error('Git URL is required');
    }
    const name =
      gitUrl
        .split('/')
        .pop()
        ?.replace(/\.git$/, '') || `unknown-plugin-${Date.now()}`;
    const pluginPath = await this.pluginsService.cloneRepo(gitUrl, name);
    const plugin = await this.pluginsService.loadPluginFromPath(pluginPath);
    return {
      uuid: plugin.__uuid,
      name: plugin.name,
      description: plugin.description,
    };
  }

  @Delete()
  async deletePlugin(@Body() body: { uuid: string }) {
    return { success: await this.pluginsService.deletePlugin(body.uuid) };
  }

  @Get('in-app')
  async getInAppPlugins() {
    return this.pluginsService.getInAppPlugins();
  }

  @Put('in-app/toggle')
  async toggleInAppPlugin(@Body() body: { pluginId: string }) {
    return this.pluginsService.toggleInAppPlugin(body.pluginId);
  }

  @Post('in-app/configure')
  async configureInAppPlugin(@Body() body: { pluginId: string; config: Record<string, any> }) {
    return this.pluginsService.configureInAppPlugin(body.pluginId, body.config);
  }

  @Post('in-app/validate')
  async validatePlugin(@Body() body: { pluginId: string }) {
    try {
      const validation = await this.pluginsService.pluginValidation(body.pluginId);
      return {
        success: true,
        message: 'Plugin validated and webhook configured successfully',
        webhookUrl: validation.webhookUrl,
        webhookSecret: validation.webhookSecret,
        instructions: validation.instructions,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Plugin validation failed',
      };
    }
  }

  @Get('provider/:id')
  async getProvider(@Param('id') id: string) {
    const provider = await this.pluginsService.getProviderById(id);
    if (!provider) {
      return { message: `No active provider found` };
    }
    return {
      id: provider.__uuid,
      name: provider.name,
      type: provider.type,
      hasProvider: true,
    };
  }
}
