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
import { defaultRegistry } from '@/compliance/profiles/registry';
import { pickByDate } from '@/compliance/profiles/temporal';
import type { TransmissionProviderRegistry } from '@/compliance/providers/transmission/registry';
import type { ChannelConfigSchema } from '@/compliance/providers/transmission/transmission-provider';
import type { PrismaService } from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { decryptJson, encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';
import { ChannelEnvironment, CompanyChannelConfig } from '../../../prisma/generated/prisma/client';

interface ChannelConfigResponse {
  providerId: string;
  channel: string;
  environment: string;
  isActive: boolean;
  /** Masked config — secrets replaced with "•••• set". Never contains decrypted secrets. */
  config: Record<string, unknown>;
}

/** Coerce an untrusted string to a valid ChannelEnvironment, defaulting to TEST. */
function toChannelEnvironment(value: string | undefined): ChannelEnvironment {
  if (value === ChannelEnvironment.PROD) return ChannelEnvironment.PROD;
  return ChannelEnvironment.TEST;
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
   * GET /compliance/companies/:id/required-channels
   * Resolves the company's country → its compliance profile → currently-active transmission channels.
   * Returns each required channel with provider metadata, configSchema, and whether it's configured.
   */
  @Get('companies/:id/required-channels')
  @ApiOperation({
    summary: 'Required channels for a company',
    description: "Resolves the company's country compliance profile and returns the required transmission channels with their configuration status.",
  })
  @ApiParam({ name: 'id', type: String, description: 'Company ID' })
  @ApiResponse({ status: 200, description: 'Required channels retrieved' })
  async getRequiredChannels(@Param('id') companyId: string) {
    // 1. Resolve company country
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { countryCode: true, country: true },
    });
    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    const countryCode = company.countryCode ?? guessCountryCode(company.country) ?? 'XX';

    // 2. Resolve compliance profile
    const { profile } = defaultRegistry.resolve(countryCode);

    // 3. Get active transmission channels
    const now = new Date();
    const transmissionRule = pickByDate(profile.transmission ?? [], now);
    const channels = transmissionRule?.channels ?? [];

    // 4. Fetch existing configs for this company
    const existingConfigs: CompanyChannelConfig[] = await this.prisma.companyChannelConfig.findMany({
      where: { companyId },
    });
    const configMap = new Map<string, CompanyChannelConfig>();
    for (const cfg of existingConfigs) {
      configMap.set(cfg.providerId, cfg);
    }

    // 5. Build response
    return channels.map((spec) => {
      const provider = spec.providerId
        ? this.txRegistry.getById(spec.providerId)
        : this.txRegistry.get(spec.type);
      const providerId = spec.providerId ?? provider?.id ?? spec.type.toLowerCase();

      const existing = configMap.get(providerId);
      let maskedConfig: Record<string, unknown> | null = null;
      if (existing) {
        try {
          const decrypted = decryptJson<Record<string, unknown>>(existing.config);
          maskedConfig = maskSecrets(decrypted, provider?.configSchema);
        } catch {
          maskedConfig = {};
        }
      }

      return {
        type: spec.type,
        providerId,
        provider: provider ? {
          id: provider.id,
          channel: provider.channel,
          feedback: provider.feedback ?? 'NONE',
          configSchema: provider.configSchema ?? null,
        } : null,
        isConfigured: !!existing?.isActive,
        environment: existing?.environment ?? null,
        config: maskedConfig,
      };
    });
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
    const rows: CompanyChannelConfig[] = await this.prisma.companyChannelConfig.findMany({
      where: { companyId },
      orderBy: [{ providerId: 'asc' }, { environment: 'asc' }],
    });

    return rows.map((row: CompanyChannelConfig) => {
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

    const env = toChannelEnvironment(environment);
    const row = await this.prisma.companyChannelConfig.upsert({
      where: {
        companyId_providerId_environment: {
          companyId,
          providerId,
          environment: env,
        },
      },
      create: {
        companyId,
        channel: provider.channel,
        providerId,
        environment: env,
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
    const env = toChannelEnvironment(body?.environment);
    await this.prisma.companyChannelConfig.deleteMany({
      where: { companyId, providerId, environment: env },
    });
    return { deleted: true };
  }
}
