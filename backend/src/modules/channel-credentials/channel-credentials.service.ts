import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '@/compliance/providers/transmission/channel-credentials-port';
import { decryptJson, encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';
import { credentialAudit } from '@/utils/credential-access-audit';
import { ChannelEnvironment, CompanyChannelConfig } from '../../../prisma/generated/prisma/client';

/** Coerce an untrusted string to a valid ChannelEnvironment, defaulting to TEST. */
function toChannelEnvironment(value: string | undefined): ChannelEnvironment {
  if (value === ChannelEnvironment.PROD) return ChannelEnvironment.PROD;
  return ChannelEnvironment.TEST;
}

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

    const row = await this.prisma.companyChannelConfig.findUnique({
      where: {
        companyId_providerId_environment: {
          companyId,
          providerId,
          environment: toChannelEnvironment(environment),
        },
      },
    });

    if (!row || !row.isActive) {
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:${environment}`,
        action: 'RESOLVE',
        outcome: 'MISS',
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    try {
      const config = decryptJson<Record<string, unknown>>(row.config);
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:${environment}`,
        action: 'RESOLVE',
        outcome: 'HIT',
        timestamp: new Date().toISOString(),
      });
      return {
        providerId: row.providerId,
        channel: row.channel,
        environment: row.environment,
        config,
        isActive: row.isActive,
      };
    } catch {
      // Corrupted blob or wrong key — treat as unconfigured rather than crash.
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:${environment}`,
        action: 'RESOLVE',
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
        context: { reason: 'decrypt_failed' },
      });
      return null;
    }
  }

  async resolveActive(
    companyId: string,
    providerId: string,
  ): Promise<ResolvedChannelConfig | null> {
    if (!isEncryptionAvailable()) return null;

    const rows: CompanyChannelConfig[] = await this.prisma.companyChannelConfig.findMany({
      where: { companyId, providerId },
      orderBy: { environment: 'asc' },
    });

    const active = rows.filter((r: CompanyChannelConfig) => r.isActive);

    if (active.length === 0) {
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:*`,
        action: 'RESOLVE_ACTIVE',
        outcome: 'MISS',
        timestamp: new Date().toISOString(),
      });
      return null;
    }

    if (active.length > 1) {
      this.logger.error(
        `Multiple active configs for company ${companyId} provider ${providerId}: ` +
        `[${active.map((r: CompanyChannelConfig) => r.environment).join(', ')}]. ` +
        `Exactly one must be active — skipping transmission.`,
      );
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:*`,
        action: 'RESOLVE_ACTIVE',
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
        context: { reason: 'multiple_active', count: active.length },
      });
      return null;
    }

    const row = active[0];
    try {
      const config = decryptJson<Record<string, unknown>>(row.config);
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:${row.environment}`,
        action: 'RESOLVE_ACTIVE',
        outcome: 'HIT',
        timestamp: new Date().toISOString(),
      });
      return {
        providerId: row.providerId,
        channel: row.channel,
        environment: row.environment,
        config,
        isActive: row.isActive,
      };
    } catch {
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:${row.environment}`,
        action: 'RESOLVE_ACTIVE',
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
        context: { reason: 'decrypt_failed' },
      });
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // §188 — Rotation seam
  // ---------------------------------------------------------------------------

  /**
   * Re-encrypt a stored credential blob under the current CREDENTIALS_ENCRYPTION_KEY.
   *
   * Use-case: after a key rotation (new key set in env), call `reEncrypt` for each
   * stored credential to migrate blobs from the old key to the new one. The caller
   * is responsible for ensuring the old key can still decrypt (e.g. pass old key
   * temporarily or run a migration script with both keys).
   *
   * Current implementation: decrypts with the current key and re-encrypts (idempotent
   * when the key has not changed). Extend to accept a `previousKey` parameter if the
   * old key is needed for a two-key migration.
   *
   * No DB migration required: all data stays in the existing `CompanyChannelConfig.config`
   * column; only the ciphertext changes.
   *
   * SECURITY: never logs the decrypted config.
   */
  async reEncrypt(companyId: string, providerId: string, environment: string): Promise<boolean> {
    if (!isEncryptionAvailable()) return false;

    const row = await this.prisma.companyChannelConfig.findUnique({
      where: {
        companyId_providerId_environment: {
          companyId,
          providerId,
          environment: toChannelEnvironment(environment),
        },
      },
    });

    if (!row) return false;

    try {
      // Decrypt with current key.
      const config = decryptJson<Record<string, unknown>>(row.config);
      // Re-encrypt under the current key (new ciphertext + fresh IV).
      const newEncrypted = encryptJson(config);
      await this.prisma.companyChannelConfig.update({
        where: { id: row.id },
        data: { config: newEncrypted, updatedAt: new Date() },
      });
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:${environment}`,
        action: 'ROTATE',
        outcome: 'HIT',
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      this.logger.error(
        `reEncrypt failed for company ${companyId} provider ${providerId}: ${(err as Error).message}`,
      );
      credentialAudit.emit({
        companyId,
        credentialRef: `${providerId}:${environment}`,
        action: 'ROTATE',
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
      });
      return false;
    }
  }
}
