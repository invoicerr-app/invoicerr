/**
 * SigningCertificatesService — per-company encrypted signing certificate store. Root TODO item 13
 * ("Signature électronique — module supprimé"), the credentials layer REPRISED from git tag
 * `avant-refonte-documents` (`modules/signing-certificates/signing-certificates.service.ts`), adapted
 * to this codebase's CURRENT `ChannelCredentialsService` conventions (`modules/company/channels/`,
 * the pattern this task was told to imitate): no injected `PrismaService` — the `prisma` singleton
 * default export is used directly; `credentialAudit` calls unchanged (that module already anticipated
 * a "Signing certs" caller — see its own header, `credentialRef` doc comment).
 *
 * WHY THIS IS A COMPANY CAPABILITY, NEVER A LEGAL OBLIGATION — read before touching this file:
 * no jurisdiction this product ships today requires us to prove a SIGNATURE on the document itself.
 * PDP (FR) accepts an unsigned Factur-X; KSeF (PL) authenticates the SESSION by token, never the
 * document; SdI (IT) accepts CAdES but that channel has no accreditation (TODO.md item 10's own
 * `sdi-transport.ts` header) — a company can go through this product's entire compliance surface
 * today without ever touching this file. Signing is therefore opt-in, company-scoped, and NEVER
 * presented as required anywhere in this module or its screen (`settings.signing.*`, front-end) — the
 * day a real sourced obligation appears (a `content-requirements/`-style dated legal citation, never
 * invented here), that is a NEW, separate fact to encode, not a retrofit of this module's own wording.
 *
 * Reprised UNCHANGED from the repère:
 *  - AES-256-GCM encryption of the PFX bytes AND the password (`utils/secret-crypto.ts`), two
 *    independent blobs — never one derived from the other.
 *  - node-forge extraction of notBefore/notAfter/serial/subject at upload time.
 *  - `resolve()`'s certRef convention: "{companyId}" or "{companyId}:{algo}" (see its own header).
 *  - The expiry check at RESOLVE time (a cert valid at upload can expire before it is next used).
 *
 * ADAPTED (deliberately, beyond the type/import path changes every reprised file has):
 *  - `upload()` now ALSO refuses an ALREADY-EXPIRED certificate outright (the repère silently stored
 *    it and only skipped it at resolve time) — root TODO item 13 explicitly asks for a noisy refusal
 *    at upload, not a certificate that sits in the store looking configured while never actually
 *    signing anything.
 *  - `delete()` is now `deactivate()` — a SOFT delete (`isActive: false`), matching this task's own
 *    "upload/list/deactivate" verb set: a signing certificate is audit-relevant history (which
 *    document was signed under which cert), unlike a channel connection's credentials, which
 *    `channels.service.ts#deleteChannelConfig` really does erase.
 *  - `rotate()` is dropped — out of scope (TODO.md's own "chaîne/renouvellement" remainder, already
 *    flagged as not done at the repère either).
 *
 * Security rules (unchanged):
 *  - encryptedPfx and encryptedPass are stored with AES-256-GCM (secret-crypto), as two SEPARATE
 *    ciphertexts.
 *  - NEVER log privateKeyPem, p12Password, or the decrypted PFX bytes.
 *  - NEVER return PFX / private-key material from HTTP endpoints — `toMeta()` is the ONLY shape a
 *    controller response is allowed to carry (see `signing-certificates.service.spec.ts`'s own
 *    "never returns" test).
 *  - Expired certs (notAfter < now) are skipped at resolve time and logged as a warn.
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
   * Resolve signing credentials for a given certRef.
   * certRef == companyId, or "{companyId}:{algo}" (see `sign-instance-pdf.ts#certRefFor`).
   *
   * Resolution order:
   *  1. Active cert with applicability matching the algo (if encoded in certRef).
   *  2. Active cert with applicability="*" (wildcard).
   *  3. null → caller passes the artifact through unsigned.
   *
   * Environment resolution mirrors `channels.service.ts`'s own convention: PROD in a production
   * process, TEST everywhere else (dev, CI, jest) — a company activates exactly one environment's
   * cert in a given slot (upload upserts by `[companyId, applicability, environment]`), so this never
   * has to choose between two active rows the way `ChannelCredentialsService.resolveActive` does.
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

    // Validity check — skip expired certs rather than crashing, and SAY why (see this file's own
    // header — this is the "jamais utilisé, dit pourquoi" half; the "refused at upload" half is
    // `upload()`'s own check, below).
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

  /** List all signing certs for a company — metadata only (see `CertificateMetaResponse`'s own
   *  header: never a PFX or password, no exceptions). */
  async listForCompany(companyId: string): Promise<CertificateMetaResponse[]> {
    const rows = await prisma.companySigningCertificate.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toMeta);
  }

  /**
   * Upload (upsert, by `[companyId, applicability, environment]`) a signing certificate.
   *  - Parses the PFX to extract metadata — throws a NAMED error for an unreadable file or a wrong
   *    password (see `parsePfx`'s own header), never a bare crash.
   *  - Refuses an ALREADY-EXPIRED certificate outright — see this file's own header, "ADAPTED".
   *  - Encrypts PFX bytes + password as two SEPARATE ciphertexts before storing.
   *  - Returns metadata only (never the decrypted material).
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
   * Deactivate a signing cert by ID — a SOFT delete (`isActive: false`), never a hard `deleteMany`:
   * see this file's own header, "ADAPTED", for why this differs from `channels.service.ts`'s own
   * `deleteChannelConfig`. Scoped by BOTH `id` AND `companyId` so a foreign company's certificate id
   * simply matches nothing (count 0) rather than ever being reachable cross-tenant.
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
