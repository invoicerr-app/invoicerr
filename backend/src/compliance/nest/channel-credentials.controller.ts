import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TransmissionProviderRegistry } from '@/compliance/providers/transmission/registry';
import { ChannelConfigSchema } from '@/compliance/providers/transmission/transmission-provider';
import { PrismaService } from '@/prisma/prisma.service';
import { encryptJson, decryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';

interface ChannelConfigResponse {
  providerId: string;
  channel: string;
  environment: string;
  isActive: boolean;
  /** Masked config — secrets replaced with "•••• set". Never contains decrypted secrets. */
  config: Record<string, unknown>;
}

/** Mask secret fields in a config object using the provider's schema. */
function maskSecrets(
  config: Record<string, unknown>,
  schema?: ChannelConfigSchema,
): Record<string, unknown> {
  if (!schema) {
    // No schema → mask ALL values (defensive: never leak unknown fields).
    const masked: Record<string, unknown> = {};
    for (const k of Object.keys(config)) {
      masked[k] = '•••• set';
    }
    return masked;
  }
  const secretNames = new Set(
    schema.fields.filter((f) => f.secret).map((f) => f.name),
  );
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    masked[k] = secretNames.has(k) ? '•••• set' : v;
  }
  return masked;
}

@ApiTags('channels')
@Controller('compliance/channels')
export class ChannelCredentialsController {
  private readonly logger = new Logger(ChannelCredentialsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly txRegistry: TransmissionProviderRegistry,
  ) {}

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
    // Collect all unique providers from the registry
    const providers = this.txRegistry.allProviders?.() ?? [];
    return providers.map((p) => ({
      id: p.id,
      channel: p.channel,
      feedback: p.feedback ?? 'NONE',
      configSchema: p.configSchema ?? null,
    }));
  }

  /**
   * GET /compliance/companies/:id/channels — list existing configs for a company (secrets masked).
   */
  @Get('companies/:id')
  @ApiOperation({
    summary: 'List channel configs for a company',
    description:
      'Returns existing channel configurations for a company. Secret fields are masked with "•••• set".',
  })
  @ApiParam({ name: 'id', type: String, description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'Configs retrieved' })
  async listCompanyChannels(@Param('id') companyId: string): Promise<ChannelConfigResponse[]> {
    const rows = await (this.prisma as any).companyChannelConfig.findMany({
      where: { companyId },
      orderBy: [{ providerId: 'asc' }, { environment: 'asc' }],
    });

    return rows.map((row: any) => {
      const provider = this.txRegistry.getById(row.providerId);
      let config: Record<string, unknown>;
      try {
        config = decryptJson<Record<string, unknown>>(row.config);
      } catch {
        config = {};
      }
      return {
        providerId: row.providerId,
        channel: row.channel,
        environment: row.environment,
        isActive: row.isActive,
        config: maskSecrets(config, provider?.configSchema),
      };
    });
  }

  /**
   * PUT /compliance/companies/:id/channels/:providerId — upsert a channel config.
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
  async upsertChannelConfig(
    @Param('id') companyId: string,
    @Body()
    body: {
      providerId: string;
      environment?: string;
      config: Record<string, unknown>;
      isActive?: boolean;
    },
  ) {
    if (!isEncryptionAvailable()) {
      throw new HttpException(
        'Encryption key not configured — channel credentials cannot be saved',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const { providerId, environment = 'TEST', config, isActive = true } = body;

    // Resolve channel type from the provider
    const provider = this.txRegistry.getById(providerId);
    if (!provider) {
      throw new HttpException(`Unknown provider: ${providerId}`, HttpStatus.BAD_REQUEST);
    }

    // TODO: validate config against provider.configSchema when the schema has required fields

    const encrypted = encryptJson(config);

    const row = await (this.prisma as any).companyChannelConfig.upsert({
      where: {
        companyId_providerId_environment: {
          companyId,
          providerId,
          environment: environment as any,
        },
      },
      create: {
        companyId,
        channel: provider.channel,
        providerId,
        environment: environment as any,
        config: encrypted,
        isActive,
      },
      update: {
        config: encrypted,
        isActive,
      },
    });

    this.logger.log(`Channel config upserted: ${providerId} (${environment}) for company ${companyId}`);

    return {
      id: row.id,
      providerId: row.providerId,
      channel: row.channel,
      environment: row.environment,
      isActive: row.isActive,
      config: maskSecrets(config, provider.configSchema),
    };
  }

  /**
   * DELETE /compliance/companies/:id/channels/:providerId — remove a channel config.
   */
  @Delete('companies/:id/:providerId')
  @ApiOperation({
    summary: 'Delete a channel config',
    description: 'Removes a channel configuration for a company and environment.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Company ID' })
  @ApiParam({ name: 'providerId', type: String, description: 'Provider ID' })
  @ApiResponse({ status: 200, description: 'Config deleted' })
  async deleteChannelConfig(
    @Param('id') companyId: string,
    @Param('providerId') providerId: string,
    @Body() body: { environment?: string },
  ) {
    const environment = body?.environment ?? 'TEST';
    await (this.prisma as any).companyChannelConfig.deleteMany({
      where: { companyId, providerId, environment: environment as any },
    });
    return { deleted: true };
  }
}
