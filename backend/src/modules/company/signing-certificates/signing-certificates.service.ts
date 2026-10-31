/**
 * Per-company encrypted signing certificate store.
 *
 * No jurisdiction this product ships requires a signature proof on the document itself (PDP accepts an
 * unsigned Factur-X, KSeF authenticates the session, SdI has no accreditation), so signing is opt-in,
 * company-scoped and never presented as required.
 *
 * Encryption: the PFX bytes and the password are two independent AES-256-GCM blobs, never one derived
 * from the other. node-forge extracts the certificate dates at upload. An expired certificate is
 * refused at upload and skipped again at resolve time, since a valid cert can expire before next use.
 * Deactivation is a soft delete, since which certificate signed which document is audit history.
 *
 * Never log the password, the private key or the decrypted PFX, and never return them over HTTP:
 * `toMeta()` is the only shape a response may carry.
 */
import * as forge from 'node-forge';
import { Injectable, Logger } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import {
  SigningCredentialsMaterial,
  SigningCredentialsPort,
} from '@/modules/documents/signing/signing-credentials-port';
import { decryptJson, encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';
import { credentialAudit } from '@/utils/credential-access-audit';
import { ChannelEnvironment, CompanySigningCertificate } from '../../../../prisma/generated/prisma/client';

// ──────────────────────────────────────────────────────────────────────────────
// Public DTOs (no secret fields — see this file's own header)
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
  /** Base64-encoded PKCS#12 (.pfx/.p12) bytes. */
  pfxBase64: string;
  /** Password for the PKCS#12 bundle. Must not be logged or returned. */
  pfxPassword: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

interface ParsedPfx {
  notBefore: Date;
  notAfter: Date;
  serial: string;
  subject: string;
  certPem: string;
  certDer: Buffer;
  privateKeyPem: string;
}

/**
 * Parse the PFX and extract cert metadata + credential material — named, actionable errors for the
 * two ways an upload legitimately fails (a corrupt file; a wrong password), never a bare forge stack
 * trace. Neither the PFX bytes nor the password are ever included in a thrown message.
 */
function parsePfx(pfxBase64: string, password: string): ParsedPfx {
  let pfxAsn1: forge.asn1.Asn1;
  try {
    const pfxDer = Buffer.from(pfxBase64, 'base64');
    pfxAsn1 = forge.asn1.fromDer(forge.util.binary.raw.encode(new Uint8Array(pfxDer)));
  } catch (err) {
    throw new Error(
      `The uploaded file is not a valid PKCS#12 (.pfx / .p12) bundle: ${(err as Error).message}`,
    );
  }

  let pfx: forge.pkcs12.Pkcs12Pfx;
  try {
    pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, password);
  } catch (err) {
    throw new Error(`Unable to open the PFX — wrong password or corrupted file: ${(err as Error).message}`);
  }

  // Extract the leaf cert (first X.509 cert found).
  const certBags = pfx.getBags({ bagType: forge.pki.oids.certBag });
  const bags = certBags[forge.pki.oids.certBag];
  if (!bags || bags.length === 0) throw new Error('The PFX contains no X.509 certificate.');

  const forgeCert = bags[0].cert;
  if (!forgeCert) throw new Error('The PFX certificate entry has no certificate attribute.');

  // Extract private key.
  const keyBags = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag = (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [])[0];
  if (!keyBag?.key) throw new Error('The PFX contains no private key.');
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

  // ── SigningCredentialsPort implementation — the PORT surface (sign-instance-pdf.ts calls this) ──

  /**
   * Resolves signing credentials for a certRef: the company id alone, or `{companyId}:{algo}`. Tries an
   * algo-specific certificate, then the wildcard, then null so the caller passes the artifact through
   * unsigned. The environment follows the process: PROD in production, TEST elsewhere.
   */
  async resolve(certRef: string): Promise<SigningCredentialsMaterial | null> {
    if (!isEncryptionAvailable()) return null;
    if (!certRef) return null;

    // The certRef may be "{companyId}" or "{companyId}:{algo}". Split on the first ":" if present.
    const colonIdx = certRef.indexOf(':');
    const companyId = colonIdx >= 0 ? certRef.slice(0, colonIdx) : certRef;
    const algo = colonIdx >= 0 ? certRef.slice(colonIdx + 1) : null;

    const environment = toChannelEnvironment(
      process.env.NODE_ENV === 'production' ? ChannelEnvironment.PROD : undefined,
    );

    // Try algo-specific cert first, then wildcard.
    const candidates: string[] = [];
    if (algo) candidates.push(algo);
    candidates.push('*');

    let row: CompanySigningCertificate | null = null;
    for (const applicability of candidates) {
      const found = await prisma.companySigningCertificate.findUnique({
        where: { companyId_applicability_environment: { companyId, applicability, environment } },
      });
      if (found && found.isActive) {
        row = found;
        break;
      }
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

    // An expired certificate is skipped rather than crashing, with a warn saying why; upload refuses
    // one outright.
    if (row.notAfter < new Date()) {
      this.logger.warn(
        `Signing cert "${row.id}" (${row.label}) for company ${companyId} expired on ` +
          `${row.notAfter.toISOString()} — skipping, artifact will be unsigned.`,
      );
      credentialAudit.emit({
        companyId,
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

  // ── The CONTROLLER surface — signing-certificates.controller.ts's settings screen ──

  /** List a company's certificates, metadata only: never a PFX or a password. */
  async listForCompany(companyId: string): Promise<CertificateMetaResponse[]> {
    const rows = await prisma.companySigningCertificate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toMeta);
  }

  /**
   * Uploads a certificate, upserting by (company, applicability, environment). The PFX is parsed for
   * metadata with a named error for a corrupt file or a wrong password, an already-expired certificate
   * is refused, and the bytes and password are encrypted as two separate blobs. Returns metadata only.
   */
  async upload(companyId: string, body: UploadCertificateBody): Promise<CertificateMetaResponse> {
    if (!isEncryptionAvailable()) {
      throw new Error('CREDENTIALS_ENCRYPTION_KEY is not set — cannot store signing certificates.');
    }

    const applicability = body.applicability ?? '*';
    const environment = toChannelEnvironment(body.environment);

    // Parse PFX to extract metadata. Throws a named error on bad password or corrupt PFX.
    const meta = parsePfx(body.pfxBase64, body.pfxPassword);

    if (meta.notAfter < new Date()) {
      throw new Error(
        `This certificate expired on ${meta.notAfter.toISOString()} — an already-expired ` +
          'certificate cannot be activated for signing.',
      );
    }

    // Encrypt — NEVER store plaintext PFX or password.
    const encryptedPfx = encryptJson(body.pfxBase64);
    const encryptedPass = encryptJson(body.pfxPassword);

    const row = await prisma.companySigningCertificate.upsert({
      where: { companyId_applicability_environment: { companyId, applicability, environment } },
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

    this.logger.log(
      `Signing certificate uploaded: "${body.label}" (${applicability}/${environment}) for company ${companyId}`,
    );
    credentialAudit.emit({
      companyId,
      credentialRef: row.id,
      action: 'UPLOAD',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
      context: { label: row.label, applicability, environment },
    });

    return toMeta(row);
  }

  /**
   * Deactivates a certificate: a soft delete, unlike a channel's credentials, because which certificate
   * signed which document is audit history. Scoped by id and companyId, so a foreign id matches nothing.
   */
  async deactivate(companyId: string, certId: string): Promise<{ deactivated: boolean }> {
    const { count } = await prisma.companySigningCertificate.updateMany({
      where: { id: certId, companyId },
      data: { isActive: false, updatedAt: new Date() },
    });
    credentialAudit.emit({
      companyId,
      credentialRef: certId,
      action: 'DEACTIVATE',
      outcome: count > 0 ? 'HIT' : 'MISS',
      timestamp: new Date().toISOString(),
    });
    return { deactivated: count > 0 };
  }
}
