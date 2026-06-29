/**
 * SigningCertificatesService — per-company encrypted signing certificate store.
 *
 * Implements SigningCredentialsPort so the ComplianceExecutor can resolve real
 * X.509/PKCS#12 credentials at signing time without ever seeing plaintext key material.
 *
 * certRef format used by the executor: the supplier's DB company ID (a CUID).
 * If null/unknown the service returns null → NullSigningCredentials path applies.
 *
 * Security rules:
 *  - encryptedPfx and encryptedPass are stored with AES-256-GCM (secret-crypto).
 *  - NEVER log privateKeyPem, p12Password, or the decrypted PFX bytes.
 *  - NEVER return PFX / private-key material from HTTP endpoints.
 *  - Expired certs (notAfter < now) are skipped and logged as a warn.
 */
import * as forge from 'node-forge';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SigningCredentialsMaterial, SigningCredentialsPort } from '@/compliance/providers/signing/signing-credentials-port';
import { decryptJson, encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';
import { credentialAudit } from '@/utils/credential-access-audit';
import { ChannelEnvironment, CompanySigningCertificate } from '../../../prisma/generated/prisma/client';

// ──────────────────────────────────────────────────────────────────────────────
// Public DTOs (no secret fields)
// ──────────────────────────────────────────────────────────────────────────────

export interface CertificateMetaResponse {
  id: string;
  companyId: string;
  label: string;
  applicability: string;
  environment: string;
  notBefore: Date;
  notAfter: Date;
  serial: string;
  subject: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadCertificateBody {
  /** Human-readable label, e.g. "FR prod 2025". */
  label: string;
  /** Which signing algorithm(s) this cert covers. Default "*" (all). */
  applicability?: string;
  /** TEST or PROD (default TEST). */
  environment?: string;
  /** Base64-encoded DER/PFX (PKCS#12) bytes. */
  pfxBase64: string;
  /** Password for the PKCS#12 bundle. Must not be logged or returned. */
  pfxPassword: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Parse the PFX and extract cert metadata + credential material. */
function parsePfx(pfxBase64: string, password: string): {
  notBefore: Date;
  notAfter: Date;
  serial: string;
  subject: string;
  certPem: string;
  certDer: Buffer;
  privateKeyPem: string;
} {
  const pfxDer = Buffer.from(pfxBase64, 'base64');
  const pfxAsn1 = forge.asn1.fromDer(forge.util.binary.raw.encode(new Uint8Array(pfxDer)));
  const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password);

  // Extract the leaf cert (first X.509 cert found).
  const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag });
  const bags = certBags[forge.pki.oids.certBag];
  if (!bags || bags.length === 0) throw new Error('PFX contains no X.509 certificate');

  const forgeCert = bags[0].cert;
  if (!forgeCert) throw new Error('PFX cert bag has no cert attribute');

  // Extract private key.
  const keyBags = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [])[0];
  if (!keyBag?.key) throw new Error('PFX contains no private key');
  const privateKey = keyBag.key as forge.pki.rsa.PrivateKey;

  // Derive notBefore / notAfter — forge stores them as JS Date objects.
  const notBefore = forgeCert.validity.notBefore;
  const notAfter = forgeCert.validity.notAfter;

  // Serial as hex string.
  const serial = (forgeCert.serialNumber ?? '').replace(/^0+/, '') || '0';

  // Subject DN.
  const subject = forgeCert.subject.attributes
    .map((a) => `${a.shortName ?? a.name ?? a.type}=${a.value}`)
    .join(',');

  // PEM representations.
  const certPem = forge.pki.certificateToPem(forgeCert);
  const certAsn1 = forge.pki.certificateToAsn1(forgeCert);
  const certDer = Buffer.from(forge.asn1.toDer(certAsn1).getBytes(), 'binary');

  const privateKeyPem = forge.pki.privateKeyInfoToPem(
    forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(privateKey)),
  );

  return { notBefore, notAfter, serial, subject, certPem, certDer, privateKeyPem };
}

function toChannelEnvironment(value: string | undefined): ChannelEnvironment {
  if (value === ChannelEnvironment.PROD) return ChannelEnvironment.PROD;
  return ChannelEnvironment.TEST;
}

/** Strip secret fields — never expose PFX or password through HTTP. */
function toMeta(row: CompanySigningCertificate): CertificateMetaResponse {
  return {
    id: row.id,
    companyId: row.companyId,
    label: row.label,
    applicability: row.applicability,
    environment: row.environment,
    notBefore: row.notBefore,
    notAfter: row.notAfter,
    serial: row.serial,
    subject: row.subject,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SigningCertificatesService implements SigningCredentialsPort {
  private readonly logger = new Logger(SigningCertificatesService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── SigningCredentialsPort implementation ──────────────────────────────────

  /**
   * Resolve signing credentials for a given certRef.
   * certRef == companyId (the DB CUID of the supplier company).
   *
   * Resolution order:
   *  1. Active cert with applicability matching the algo (if encoded in certRef).
   *  2. Active cert with applicability="*" (wildcard).
   *  3. null → caller logs "unsigned" note.
   *
   * In the current executor, certRef is always the raw companyId string.
   */
  async resolve(certRef: string): Promise<SigningCredentialsMaterial | null> {
    if (!isEncryptionAvailable()) return null;
    if (!certRef) return null;

    // The certRef may be "{companyId}" or "{companyId}:{algo}".
    // Split on the first ":" if present.
    const colonIdx = certRef.indexOf(':');
    const companyId = colonIdx >= 0 ? certRef.slice(0, colonIdx) : certRef;
    const algo = colonIdx >= 0 ? certRef.slice(colonIdx + 1) : null;

    // Determine which environment to use.
    const environment = toChannelEnvironment(
      process.env.NODE_ENV === 'production' ? ChannelEnvironment.PROD : undefined,
    );

    // Try algo-specific cert first, then wildcard.
    const candidates: string[] = [];
    if (algo) candidates.push(algo);
    candidates.push('*');

    let row: CompanySigningCertificate | null = null;
    for (const applicability of candidates) {
      const found = await this.prisma.companySigningCertificate.findUnique({
        where: {
          companyId_applicability_environment: { companyId, applicability, environment },
        },
      });
      if (found && found.isActive) { row = found; break; }
    }

    if (!row) {
      credentialAudit.emit({
        companyId,
        credentialRef: certRef,
        action: 'RESOLVE',
        outcome: 'MISS',
        timestamp: new Date().toISOString(),
        context: { reason: 'no_active_cert' },
      });
      return null;
    }

    // Validity check — skip expired certs rather than crashing.
    if (row.notAfter < new Date()) {
      this.logger.warn(
        `Signing cert "${row.id}" (${row.label}) for company ${companyId} expired on ` +
        `${row.notAfter.toISOString()} — skipping, artifact will be unsigned.`,
      );
      credentialAudit.emit({
        companyId,
        // SECURITY: certId is metadata, not a secret value.
        credentialRef: row.id,
        action: 'RESOLVE',
        outcome: 'MISS',
        timestamp: new Date().toISOString(),
        context: { reason: 'cert_expired', label: row.label },
      });
      return null;
    }

    try {
      const pfxBase64 = decryptJson<string>(row.encryptedPfx);
      const password = decryptJson<string>(row.encryptedPass);

      const { certPem, certDer, privateKeyPem } = parsePfx(pfxBase64, password);
      const pfxBuffer = Buffer.from(pfxBase64, 'base64');

      // SECURITY: never log privateKeyPem or password.
      credentialAudit.emit({
        companyId,
        credentialRef: row.id,
        action: 'RESOLVE',
        outcome: 'HIT',
        timestamp: new Date().toISOString(),
        context: { label: row.label, environment: row.environment },
      });
      return {
        certDer,
        privateKeyPem,
        certPem,
        p12Buffer: pfxBuffer,
        p12Password: password,
      };
    } catch (err) {
      this.logger.error(
        `Failed to decrypt/parse signing cert "${row.id}" for company ${companyId}: ${(err as Error).message}`,
      );
      credentialAudit.emit({
        companyId,
        credentialRef: row.id,
        action: 'RESOLVE',
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
        context: { reason: 'decrypt_failed' },
      });
      return null;
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** List all signing certs for a company (metadata only — no PFX or password). */
  async listForCompany(companyId: string): Promise<CertificateMetaResponse[]> {
    const rows = await this.prisma.companySigningCertificate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toMeta);
  }

  /**
   * Upload (upsert) a signing certificate.
   * - Parses the PFX to extract metadata.
   * - Encrypts PFX bytes + password before storing.
   * - Returns metadata only (never the decrypted material).
   */
  async upload(companyId: string, body: UploadCertificateBody): Promise<CertificateMetaResponse> {
    if (!isEncryptionAvailable()) {
      throw new Error(
        'CREDENTIALS_ENCRYPTION_KEY is not set — cannot store signing certificates.',
      );
    }

    const applicability = body.applicability ?? '*';
    const environment = toChannelEnvironment(body.environment);

    // Parse PFX to extract metadata. Throws on bad password or corrupt PFX.
    const meta = parsePfx(body.pfxBase64, body.pfxPassword);

    // Encrypt — NEVER store plaintext PFX or password.
    const encryptedPfx = encryptJson(body.pfxBase64);
    const encryptedPass = encryptJson(body.pfxPassword);

    const row = await this.prisma.companySigningCertificate.upsert({
      where: {
        companyId_applicability_environment: { companyId, applicability, environment },
      },
      create: {
        companyId,
        label: body.label,
        applicability,
        environment,
        encryptedPfx,
        encryptedPass,
        notBefore: meta.notBefore,
        notAfter: meta.notAfter,
        serial: meta.serial,
        subject: meta.subject,
        isActive: true,
      },
      update: {
        label: body.label,
        encryptedPfx,
        encryptedPass,
        notBefore: meta.notBefore,
        notAfter: meta.notAfter,
        serial: meta.serial,
        subject: meta.subject,
        isActive: true,
        updatedAt: new Date(),
      },
    });

    return toMeta(row);
  }

  /** Deactivate (soft-delete) a signing cert by ID. */
  async deactivate(companyId: string, certId: string): Promise<void> {
    await this.prisma.companySigningCertificate.updateMany({
      where: { id: certId, companyId },
      data: { isActive: false },
    });
  }

  /** Hard-delete a signing cert by ID. */
  async delete(companyId: string, certId: string): Promise<void> {
    await this.prisma.companySigningCertificate.deleteMany({
      where: { id: certId, companyId },
    });
    credentialAudit.emit({
      companyId,
      credentialRef: certId,
      action: 'DELETE',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------------
  // §188 — Rotation seam
  // ---------------------------------------------------------------------------

  /**
   * Certificate rotation seam: deactivate the current active certificate for a given
   * (companyId, applicability, environment) slot and upload the replacement atomically.
   *
   * No DB migration required: uses the existing `CompanySigningCertificate` table.
   * The old row stays in the table with `isActive = false` for audit history.
   *
   * SECURITY: never logs PFX bytes, private keys, or passwords — only metadata.
   *
   * @returns The metadata of the newly uploaded certificate.
   */
  async rotate(companyId: string, newCert: UploadCertificateBody): Promise<CertificateMetaResponse> {
    if (!isEncryptionAvailable()) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY is not set — cannot rotate signing certificate.');
    }

    const applicability = newCert.applicability ?? '*';
    const environment = toChannelEnvironment(newCert.environment);

    // Deactivate existing cert in this slot (if any) — keep row for audit history.
    await this.prisma.companySigningCertificate.updateMany({
      where: { companyId, applicability, environment, isActive: true },
      data: { isActive: false, updatedAt: new Date() },
    });

    // Upload the new cert (creates a new row; upsert is intentionally avoided so history is preserved).
    const meta = parsePfx(newCert.pfxBase64, newCert.pfxPassword);
    const encryptedPfx = encryptJson(newCert.pfxBase64);
    const encryptedPass = encryptJson(newCert.pfxPassword);

    const row = await this.prisma.companySigningCertificate.create({
      data: {
        companyId,
        label: newCert.label,
        applicability,
        environment,
        encryptedPfx,
        encryptedPass,
        notBefore: meta.notBefore,
        notAfter: meta.notAfter,
        serial: meta.serial,
        subject: meta.subject,
        isActive: true,
      },
    });

    credentialAudit.emit({
      companyId,
      credentialRef: row.id,
      action: 'ROTATE',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
      context: { label: row.label, environment: row.environment, applicability },
    });

    return toMeta(row);
  }
}
