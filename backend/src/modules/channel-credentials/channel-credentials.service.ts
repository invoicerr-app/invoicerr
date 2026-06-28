import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '@/compliance/providers/transmission/channel-credentials-port';
import { decryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';

/**
 * Resolves per-company channel credentials from the DB, decrypting the config blob.
 * Lives outside compliance to avoid the compliance ↔ invoices cycle.
 */
@Injectable()
export class ChannelCredentialsService implements ChannelCredentialsPort {
  private readonly logger = new Logger(ChannelCredentialsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    companyId: string,
    providerId: string,
    environment: string,
  ): Promise<ResolvedChannelConfig | null> {
    if (!isEncryptionAvailable()) return null;

    const row = await (this.prisma as any).companyChannelConfig.findUnique({
      where: {
        companyId_providerId_environment: {
          companyId,
          providerId,
          environment: environment as any,
        },
      },
    });

    if (!row || !row.isActive) return null;

    try {
      const config = decryptJson<Record<string, unknown>>(row.config);
      return {
        providerId: row.providerId,
        channel: row.channel,
        environment: row.environment,
        config,
        isActive: row.isActive,
      };
    } catch {
      // Corrupted blob or wrong key — treat as unconfigured rather than crash.
      return null;
    }
  }

  async resolveActive(
    companyId: string,
    providerId: string,
  ): Promise<ResolvedChannelConfig | null> {
    if (!isEncryptionAvailable()) return null;

    const rows = await (this.prisma as any).companyChannelConfig.findMany({
      where: { companyId, providerId },
      orderBy: { environment: 'asc' },
    });

    const active = rows.filter((r: any) => r.isActive);

    if (active.length === 0) return null;

    if (active.length > 1) {
      this.logger.error(
        `Multiple active configs for company ${companyId} provider ${providerId}: ` +
        `[${active.map((r: any) => r.environment).join(', ')}]. ` +
        `Exactly one must be active — skipping transmission.`,
      );
      return null;
    }

    const row = active[0];
    try {
      const config = decryptJson<Record<string, unknown>>(row.config);
      return {
        providerId: row.providerId,
        channel: row.channel,
        environment: row.environment,
        config,
        isActive: row.isActive,
      };
    } catch {
      return null;
    }
  }
}
