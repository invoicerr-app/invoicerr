import { PluginsService } from '@/modules/plugins/plugins.service';
import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

// TODO_SUITE.md P2 (2026-09-03) — this controller used to ALSO expose the external, git-clone
// plugin mechanism: `GET /plugins`, `GET /plugins/formats`, `POST /plugins` (clone a Git URL and
// dynamically `import()` it), `DELETE /plugins` (uninstall). Removed — no route above answers
// those paths any more. See `plugins.service.ts`'s own header and TODO_ISSUES.md ("Le système de
// plugins, vu par son premier vrai consommateur", T5c) for why. Only the in-app plugins API
// (`PluginRegistry`/`PluginType`, the Settings > Plugins screen) remains below.
@ApiTags('plugins')
@Controller('plugins')
export class PluginsController {
  constructor(private readonly pluginsService: PluginsService) {}

  @Get('in-app')
  @ApiOperation({
    summary: 'List in-app plugins',
    description: 'Returns all built-in (non-installed) plugins available in the application.',
  })
  @ApiResponse({ status: 200, description: 'In-app plugins retrieved' })
  async getInAppPlugins() {
    return this.pluginsService.getInAppPlugins();
  }

  @Put('in-app/toggle')
  @ApiOperation({ summary: 'Toggle an in-app plugin', description: 'Enables or disables a built-in plugin.' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { pluginId: { type: 'string', description: 'In-app plugin ID' } },
      required: ['pluginId'],
    },
  })
  @ApiResponse({ status: 200, description: 'Plugin toggled' })
  async toggleInAppPlugin(@Body() body: { pluginId: string }) {
    return this.pluginsService.toggleInAppPlugin(body.pluginId);
  }

  @Post('in-app/configure')
  @ApiOperation({
    summary: 'Configure an in-app plugin',
    description: 'Updates the configuration of a built-in plugin.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        pluginId: { type: 'string', description: 'In-app plugin ID' },
        config: {
          type: 'object',
          additionalProperties: true,
          description: 'Plugin-specific configuration object',
        },
      },
      required: ['pluginId', 'config'],
    },
  })
  @ApiResponse({ status: 201, description: 'Plugin configured' })
  async configureInAppPlugin(@Body() body: { pluginId: string; config: Record<string, any> }) {
    return this.pluginsService.configureInAppPlugin(body.pluginId, body.config);
  }

  @Post('in-app/validate')
  @ApiOperation({
    summary: 'Validate a plugin',
    description:
      'Runs the plugin validation logic and returns the webhook URL, secret, and setup instructions.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { pluginId: { type: 'string', description: 'In-app plugin ID' } },
      required: ['pluginId'],
    },
  })
  @ApiResponse({ status: 201, description: 'Plugin validated' })
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
}
