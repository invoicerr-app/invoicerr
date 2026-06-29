import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { defaultRegistry } from '@/compliance/profiles/registry';
import { TransmissionProviderRegistry } from '@/compliance/providers/transmission/registry';
import type { ChannelConfigSchema } from '@/compliance/providers/transmission/transmission-provider';
import { PrismaService } from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { decryptJson, encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';
import { ChannelEnvironment, CompanyChannelConfig } from '../../../prisma/generated/prisma/client';

export interface ChannelConfigResponse {
  providerId: string;
  channel: string;
  environment: string;
  isActive: boolean;
  /** Masked config — secrets replaced with "•••• set". Never contains decrypted secrets. */
  config: Record<string, unknown>;
}

export interface UpsertChannelConfigBody {
  providerId: string;
  environment?: string;
  config: Record<string, unknown>;
  isActive?: boolean;
}

/** Coerce an untrusted string to a valid ChannelEnvironment, defaulting to TEST. */
function toChannelEnvironment(value: string | undefined): ChannelEnvironment {
  if (value === ChannelEnvironment.PROD) return ChannelEnvironment.PROD;
  return ChannelEnvironment.TEST;
}

/** Derive a 10-digit tax id (e.g. Polish NIP) from a company's identifiers. */
function deriveTaxId(identifiers: { scheme: string; value: string }[]): string | undefined {
  const raw =
    identifiers.find((i) => i.scheme === 'VAT')?.value ??
    identifiers.find((i) => i.scheme === 'LEGAL_ID')?.value;
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits || undefined;
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
  const secretNames = new Set(schema.fields.filter((f) => f.secret).map((f) => f.name));
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    masked[k] = secretNames.has(k) ? '•••• set' : v;
  }
  return masked;
}

/**
 * Backs {@link ChannelCredentialsController}: company channel-config CRUD + the country-driven
 * "required channels" resolution. All DB access goes through {@link PrismaService}; the controller
 * stays a thin HTTP layer (controller → service → prisma).
 */
@Injectable()
export class ChannelSettingsService {
  private readonly logger = new Logger(ChannelSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly txRegistry: TransmissionProviderRegistry,
  ) {}

  /** All registered transmission providers + their configSchema (UI form definitions). */
  listProviders() {
    const providers = this.txRegistry.allProviders?.() ?? [];
    return providers.map((p) => ({
      id: p.id,
      channel: p.channel,
      feedback: p.feedback ?? 'NONE',
      configSchema: p.configSchema ?? null,
    }));
  }

  /**
   * Resolves the company's country → compliance profile → currently-active transmission channels,
   * each annotated with provider metadata, configSchema, and whether it's already configured.
   */
  async getRequiredChannels(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { countryCode: true, country: true },
    });
    if (!company) {
      throw new HttpException('Company not found', HttpStatus.NOT_FOUND);
    }

    const countryCode = company.countryCode ?? guessCountryCode(company.country) ?? 'XX';
    const { profile } = defaultRegistry.resolve(countryCode);

    // Surface channels in force now AND upcoming ones (e.g. the French PDP mandate from
    // 2026-09-01) so a company can connect/configure ahead of go-live. Fully-expired windows
    // (validTo already passed) are dropped. Each channel is annotated with the earliest date it
    // applies (`availableFrom`) so the UI can flag upcoming ones.
    type TransmissionRule = NonNullable<typeof profile.transmission>[number];
    type ChannelSpec = TransmissionRule['value']['channels'][number];

    const now = Date.now();
    const liveRules = (profile.transmission ?? [])
      .filter((r) => !r.validTo || new Date(r.validTo).getTime() > now)
      .sort((a, b) => new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime());

    // De-dupe by channel (keep the earliest window a channel appears in).
    const specs = new Map<string, { spec: ChannelSpec; availableFrom: string }>();
    for (const rule of liveRules) {
      for (const spec of rule.value.channels) {
        const key = spec.providerId ?? spec.type;
        if (!specs.has(key)) specs.set(key, { spec, availableFrom: rule.validFrom });
      }
    }

    const existingConfigs: CompanyChannelConfig[] = await this.prisma.companyChannelConfig.findMany({
      where: { companyId },
    });
    const configMap = new Map<string, CompanyChannelConfig>();
    for (const cfg of existingConfigs) {
      configMap.set(cfg.providerId, cfg);
    }

    return [...specs.values()].map(({ spec, availableFrom }) => {
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
        availableFrom,
        provider: provider
          ? {
              id: provider.id,
              channel: provider.channel,
              feedback: provider.feedback ?? 'NONE',
              configSchema: provider.configSchema ?? null,
            }
          : null,
        isConfigured: !!existing?.isActive,
        environment: existing?.environment ?? null,
        config: maskedConfig,
      };
    });
  }

  /** Existing channel configs for a company (secrets masked). */
  async listCompanyChannels(companyId: string): Promise<ChannelConfigResponse[]> {
    const rows: CompanyChannelConfig[] = await this.prisma.companyChannelConfig.findMany({
      where: { companyId },
      orderBy: [{ providerId: 'asc' }, { environment: 'asc' }],
    });

    return rows.map((row) => {
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

  /** Create/update a channel config. The blob is encrypted at rest; secrets are never logged. */
  async upsertChannelConfig(companyId: string, body: UpsertChannelConfigBody) {
    if (!isEncryptionAvailable()) {
      throw new HttpException(
        'Encryption key not configured — channel credentials cannot be saved',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const { providerId, environment = 'TEST', config, isActive = true } = body;

    const provider = this.txRegistry.getById(providerId);
    if (!provider) {
      throw new HttpException(`Unknown provider: ${providerId}`, HttpStatus.BAD_REQUEST);
    }

    // Auto-fill identity the channel needs from the company, so the user isn't asked for data
    // already held on the company. KSeF authenticates per NIP (a required company identifier).
    const enrichedConfig = { ...config };
    if (provider.id === 'ksef' && !enrichedConfig.nip) {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        include: { partyIdentifiers: { select: { scheme: true, value: true } } },
      });
      const nip = deriveTaxId(company?.partyIdentifiers ?? []);
      if (nip) enrichedConfig.nip = nip;
    }

    const encrypted = encryptJson(enrichedConfig);
    const env = toChannelEnvironment(environment);

    const row = await this.prisma.companyChannelConfig.upsert({
      where: {
        companyId_providerId_environment: { companyId, providerId, environment: env },
      },
      create: {
        companyId,
        channel: provider.channel,
        providerId,
        environment: env,
        config: encrypted,
        isActive,
      },
      update: { config: encrypted, isActive },
    });

    this.logger.log(`Channel config upserted: ${providerId} (${env}) for company ${companyId}`);

    return {
      id: row.id,
      providerId: row.providerId,
      channel: row.channel,
      environment: row.environment,
      isActive: row.isActive,
      config: maskSecrets(enrichedConfig, provider.configSchema),
    };
  }

  /** Remove a channel config for a company + environment. */
  async deleteChannelConfig(companyId: string, providerId: string, environment: string | undefined) {
    const env = toChannelEnvironment(environment);
    await this.prisma.companyChannelConfig.deleteMany({
      where: { companyId, providerId, environment: env },
    });
    return { deleted: true };
  }
}
