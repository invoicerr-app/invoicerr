import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ChannelConfigResponse,
  ChannelSettingsService,
  UpsertChannelConfigBody,
} from './channel-settings.service';

@ApiTags('channels')
@Controller('compliance/channels')
export class ChannelCredentialsController {
  constructor(private readonly channels: ChannelSettingsService) {}

  /**
   * GET /compliance/channels — list all available providers and their configSchemas.
   * Used by the frontend to render the channel configuration UI.
   */
  @Get()
  @ApiOperation({
    summary: 'List available channel providers',
    description:
      'Returns all registered transmission providers and their configSchema (form definition) for the UI.',
  })
  @ApiResponse({ status: 200, description: 'Providers retrieved' })
  listProviders() {
    return this.channels.listProviders();
  }

  /**
   * GET /compliance/channels/companies/:id/required-channels
   * Resolves the company's country → its compliance profile → currently-active transmission channels.
   */
  @Get('companies/:id/required-channels')
  @ApiOperation({
    summary: 'Required channels for a company',
    description:
      "Resolves the company's country compliance profile and returns the required transmission channels with their configuration status.",
  })
  @ApiParam({ name: 'id', type: String, description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'Required channels retrieved' })
  getRequiredChannels(@Param('id') companyId: string) {
    return this.channels.getRequiredChannels(companyId);
  }

  /**
   * GET /compliance/channels/companies/:id — list existing configs for a company (secrets masked).
   */
  @Get('companies/:id')
  @ApiOperation({
    summary: 'List channel configs for a company',
    description:
      'Returns existing channel configurations for a company. Secret fields are masked with "•••• set".',
  })
  @ApiParam({ name: 'id', type: String, description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'Configs retrieved' })
  listCompanyChannels(@Param('id') companyId: string): Promise<ChannelConfigResponse[]> {
    return this.channels.listCompanyChannels(companyId);
  }

  /**
   * PUT /compliance/channels/companies/:id — upsert a channel config.
   * Validates against the provider's configSchema. Encrypts the blob before storing.
   */
  @Put('companies/:id')
  @ApiOperation({
    summary: 'Upsert a channel config',
    description:
      'Creates or updates a channel configuration for a company. The config blob is encrypted at rest. Secret fields in the request are never logged.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Company ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        providerId: { type: 'string', example: 'ksef' },
        environment: { type: 'string', enum: ['TEST', 'PROD'], default: 'TEST' },
        config: { type: 'object', additionalProperties: true },
        isActive: { type: 'boolean', default: true },
      },
      required: ['providerId', 'config'],
    },
  })
  @ApiResponse({ status: 200, description: 'Config upserted' })
  upsertChannelConfig(@Param('id') companyId: string, @Body() body: UpsertChannelConfigBody) {
    return this.channels.upsertChannelConfig(companyId, body);
  }

  /**
   * DELETE /compliance/channels/companies/:id/:providerId — remove a channel config.
   */
  @Delete('companies/:id/:providerId')
  @ApiOperation({
    summary: 'Delete a channel config',
    description: 'Removes a channel configuration for a company and environment.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Company ID' })
  @ApiParam({ name: 'providerId', type: String, description: 'Provider ID' })
  @ApiResponse({ status: 200, description: 'Config deleted' })
  deleteChannelConfig(
    @Param('id') companyId: string,
    @Param('providerId') providerId: string,
    @Body() body: { environment?: string },
  ) {
    return this.channels.deleteChannelConfig(companyId, providerId, body?.environment);
  }
}
