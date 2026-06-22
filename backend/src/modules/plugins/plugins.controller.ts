import { PluginsService } from '@/modules/plugins/plugins.service';
import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';


@ApiTags('plugins')
@Controller('plugins')
export class PluginsController {
  constructor(private readonly pluginsService: PluginsService) { }

  @Get()
  @ApiOperation({ summary: 'List installed plugins', description: 'Returns all installed plugins with their UUID, name, and description.' })
  @ApiResponse({ status: 200, description: 'Plugins retrieved' })
  async getPlugins() {
    return this.pluginsService.getPlugins().map((plugin) => ({
      uuid: plugin.__uuid,
      name: plugin.name,
      description: plugin.description,
    }));
  }

  @Get('formats')
  @ApiOperation({ summary: 'List available output formats', description: 'Returns the list of output formats provided by installed plugins (e.g. PDF, XRechnung).' })
  @ApiResponse({ status: 200, description: 'Formats retrieved' })
  async getFormats() {
    return this.pluginsService.getFormats();
  }

  @Post()
  @ApiOperation({ summary: 'Install a plugin from a Git URL', description: 'Clones a Git repository and loads it as a plugin.' })
  @ApiBody({ schema: { type: 'object', properties: { gitUrl: { type: 'string', description: 'Git repository URL to clone' } }, required: ['gitUrl'] } })
  @ApiResponse({ status: 201, description: 'Plugin installed' })
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
  @ApiOperation({ summary: 'Uninstall a plugin', description: 'Deletes a plugin by its UUID.' })
  @ApiBody({ schema: { type: 'object', properties: { uuid: { type: 'string', description: 'Plugin UUID' } }, required: ['uuid'] } })
  @ApiResponse({ status: 200, description: 'Plugin uninstalled' })
  async deletePlugin(@Body() body: { uuid: string }) {
    return { success: await this.pluginsService.deletePlugin(body.uuid) };
  }

  @Get('in-app')
  @ApiOperation({ summary: 'List in-app plugins', description: 'Returns all built-in (non-installed) plugins available in the application.' })
  @ApiResponse({ status: 200, description: 'In-app plugins retrieved' })
  async getInAppPlugins() {
    return this.pluginsService.getInAppPlugins();
  }

  @Put('in-app/toggle')
  @ApiOperation({ summary: 'Toggle an in-app plugin', description: 'Enables or disables a built-in plugin.' })
  @ApiBody({ schema: { type: 'object', properties: { pluginId: { type: 'string', description: 'In-app plugin ID' } }, required: ['pluginId'] } })
  @ApiResponse({ status: 200, description: 'Plugin toggled' })
  async toggleInAppPlugin(@Body() body: { pluginId: string }) {
    return this.pluginsService.toggleInAppPlugin(body.pluginId);
  }

  @Post('in-app/configure')
  @ApiOperation({ summary: 'Configure an in-app plugin', description: 'Updates the configuration of a built-in plugin.' })
  @ApiBody({ schema: { type: 'object', properties: { pluginId: { type: 'string', description: 'In-app plugin ID' }, config: { type: 'object', additionalProperties: true, description: 'Plugin-specific configuration object' } }, required: ['pluginId', 'config'] } })
  @ApiResponse({ status: 201, description: 'Plugin configured' })
  async configureInAppPlugin(
    @Body() body: { pluginId: string; config: Record<string, any> }
  ) {
    return this.pluginsService.configureInAppPlugin(body.pluginId, body.config);
  }

  @Post('in-app/validate')
  @ApiOperation({ summary: 'Validate a plugin', description: 'Runs the plugin validation logic and returns the webhook URL, secret, and setup instructions.' })
  @ApiBody({ schema: { type: 'object', properties: { pluginId: { type: 'string', description: 'In-app plugin ID' } }, required: ['pluginId'] } })
  @ApiResponse({ status: 201, description: 'Plugin validated' })
  async validatePlugin(@Body() body: { pluginId: string }) {
    try {
      const validation = await this.pluginsService.pluginValidation(body.pluginId);
      return {
        success: true,
        message: 'Plugin validated and webhook configured successfully',
        webhookUrl: validation.webhookUrl,
        webhookSecret: validation.webhookSecret,
        instructions: validation.instructions
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Plugin validation failed'
      };
    }
  }

}
