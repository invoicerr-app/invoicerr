/**
 * Real cryptographic signing providers for XAdES, CAdES, PAdES, and the none pass-through.
 *
 * Security rules enforced here:
 *  - Private key / p12 password is NEVER logged (not even at debug level).
 *  - If no credential is resolved, the artifact is returned unsigned with a warn log.
 *  - No ASN.1 or crypto primitives are hand-rolled — only maintained libraries are used.
 *
 * TSA / -T / -LT / -LTA timestamps are stubbed: the code is structured to accept a
 * TSA URL (see tsa hook comments) but does not call an external timestamp server.
 */
import * as forge from 'node-forge';
import { Application as XmldsigApp, Parse as XmlParse } from 'xmldsigjs';
import { setNodeDependencies } from 'xadesjs';
import { SignedXml } from 'xadesjs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { PDFDocument } from 'pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';

import { ComplianceLogger } from '../../execution/logger';
import { RenderedArtifact, SignedArtifact } from '../../execution/types';
import { SignAlgo, SigningProvider } from './signing-provider';
import {
  NullSigningCredentials,
  SigningCredentialsMaterial,
  SigningCredentialsPort,
} from './signing-credentials-port';

// ---------------------------------------------------------------------------
// One-time DOM + WebCrypto engine setup for xmldsigjs / xadesjs.
//
// xmldsigjs and xadesjs each bundle their own copy of xml-core, so we must
// call setNodeDependencies on BOTH instances.  We resolve the xmldsigjs copy
// at runtime via require.resolve so we don't hard-code a nested path.
//
// Node.js 18+ provides globalThis.crypto; @xmldom/xmldom provides DOMParser.
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-require-imports */
let _engineInitialised = false;
function ensureXmlCryptoEngine(): void {
  if (_engineInitialised) return;

  const xmlDomDeps = { DOMParser, XMLSerializer } as Parameters<typeof setNodeDependencies>[0];

  // 1. Set DOM deps on xadesjs's bundled xml-core.
  setNodeDependencies(xmlDomDeps);

  // 2. Set DOM deps on xmldsigjs's bundled xml-core (a separate module instance).
  const path = require('path') as typeof import('path');
  const xmldsigDir = path.dirname(require.resolve('xmldsigjs'));
  const xmldsigXmlCore = require(require.resolve('xml-core', { paths: [xmldsigDir] })) as {
    setNodeDependencies: typeof setNodeDependencies;
  };
  xmldsigXmlCore.setNodeDependencies(xmlDomDeps);

  // 3. Register native Node.js Web Crypto API as the signing engine for xmldsigjs.
  XmldsigApp.setEngine('native', globalThis.crypto as Crypto);

  _engineInitialised = true;
}
/* eslint-enable @typescript-eslint/no-require-imports */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// RSA PKCS#1 v1.5 with SHA-256 — covers the majority of PKI certs in use.
const RSA_ALGO: RsaHashedImportParams = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

/**
 * Import a PKCS#8 PEM private key as a WebCrypto CryptoKey (RSASSA-PKCS1-v1_5/SHA-256).
 */
async function importPrivateKeyPem(pem: string): Promise<CryptoKey> {
  const pemBody = pem.replace(/-----BEGIN[^-]*-----|-----END[^-]*-----|\r?\n/g, '');
  const der = Buffer.from(pemBody, 'base64');
  return crypto.subtle.importKey('pkcs8', der, RSA_ALGO, false, ['sign']);
}

/**
 * Extract the SubjectPublicKeyInfo (SPKI) bytes from a DER-encoded X.509 certificate
 * using node-forge, then import as a WebCrypto CryptoKey.
 */
async function importPublicKeyFromCertDer(certDer: Buffer): Promise<CryptoKey> {
  const certAsn1 = forge.asn1.fromDer(forge.util.binary.raw.encode(new Uint8Array(certDer)));
  const forgeCert = forge.pki.certificateFromAsn1(certAsn1);
  const spkiAsn1 = forge.pki.publicKeyToAsn1(forgeCert.publicKey as forge.pki.rsa.PublicKey);
  const spkiDer = Buffer.from(forge.asn1.toDer(spkiAsn1).getBytes(), 'binary');
  return crypto.subtle.importKey('spki', spkiDer, RSA_ALGO, true, ['verify']);
}

// ---------------------------------------------------------------------------
// XAdES provider — enveloped XAdES-BES over XML documents
// ---------------------------------------------------------------------------

export class XadesSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'XAdES';

  constructor(private readonly credentials: SigningCredentialsPort = new NullSigningCredentials()) {}

  async sign(rendered: RenderedArtifact, certRef: string, log: ComplianceLogger): Promise<SignedArtifact> {
    const material = await this.credentials.resolve(certRef);
    if (!material) {
      log.warn('signing/xades', `No signing cert configured for "${certRef}" — artifact passed through unsigned`);
      return { ...rendered };
    }

    try {
      ensureXmlCryptoEngine();

      const xmlString = Buffer.from(rendered.bytes).toString('utf-8');
      const xmlDoc = XmlParse(xmlString);

      const [privateKey, publicKey] = await Promise.all([
        importPrivateKeyPem(material.privateKeyPem),
        importPublicKeyFromCertDer(material.certDer),
      ]);

      const signedXml = new SignedXml();
      await signedXml.Sign(
        RSA_ALGO,
        privateKey,
        xmlDoc,
        {
          keyValue: publicKey,
          references: [{ hash: 'SHA-256', transforms: ['enveloped'] }],
          // TSA hook (stubbed — wire a real TSA URL here for XAdES-T):
          // tsaUrl: process.env.TSA_URL,
        },
      );

      const signedXmlString = signedXml.toString();
      const signedBytes = Buffer.from(signedXmlString, 'utf-8');

      log.info('signing/xades', `XAdES-BES signed ${rendered.syntax} with cert "${certRef}" (${signedBytes.length} bytes)`);
      return {
        ...rendered,
        bytes: new Uint8Array(signedBytes),
        signature: { algo: 'XAdES', certRef },
      };
    } catch (err) {
      log.warn('signing/xades', `XAdES signing failed for "${certRef}": ${(err as Error).message} — artifact passed through unsigned`);
      return { ...rendered };
    }
  }
}

// ---------------------------------------------------------------------------
// CAdES provider — CAdES-BES PKCS#7 (.p7m) enveloping signature
// ---------------------------------------------------------------------------

export class CadesSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'CAdES';

  constructor(private readonly credentials: SigningCredentialsPort = new NullSigningCredentials()) {}

  async sign(rendered: RenderedArtifact, certRef: string, log: ComplianceLogger): Promise<SignedArtifact> {
    const material = await this.credentials.resolve(certRef);
    if (!material) {
      log.warn('signing/cades', `No signing cert configured for "${certRef}" — artifact passed through unsigned`);
      return { ...rendered };
    }

    try {
      const p7mBytes = await this.signWithForge(rendered.bytes, material);
      log.info('signing/cades', `CAdES-BES signed ${rendered.syntax} with cert "${certRef}" (${p7mBytes.length} bytes .p7m)`);
      return {
        ...rendered,
        bytes: new Uint8Array(p7mBytes),
        mime: 'application/pkcs7-mime',
        signature: { algo: 'CAdES', certRef },
      };
    } catch (err) {
      log.warn('signing/cades', `CAdES signing failed for "${certRef}": ${(err as Error).message} — artifact passed through unsigned`);
      return { ...rendered };
    }
  }

  private async signWithForge(content: Uint8Array, material: SigningCredentialsMaterial): Promise<Buffer> {
    const forgeCert = forge.pki.certificateFromPem(material.certPem);
    const forgeKey = forge.pki.privateKeyFromPem(material.privateKeyPem);

    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(Buffer.from(content).toString('binary'));
    p7.addCertificate(forgeCert);
    p7.addSigner({
      key: forgeKey as forge.pki.rsa.PrivateKey,
      certificate: forgeCert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        // signingTime: omit value — forge fills it in automatically from current time
        { type: forge.pki.oids.signingTime },
        // TSA hook (stubbed — add unsigned attribute for CAdES-T here):
        // { type: forge.pki.oids.signingCertificate, ... }
      ],
    });
    p7.sign({ detached: false });

    const asn1 = p7.toAsn1();
    const derString = forge.asn1.toDer(asn1).getBytes();
    return Buffer.from(derString, 'binary');
  }
}

// ---------------------------------------------------------------------------
// PAdES provider — PAdES-B signature embedded in PDF
// ---------------------------------------------------------------------------

export class PadesSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'PAdES';

  constructor(private readonly credentials: SigningCredentialsPort = new NullSigningCredentials()) {}

  async sign(rendered: RenderedArtifact, certRef: string, log: ComplianceLogger): Promise<SignedArtifact> {
    const material = await this.credentials.resolve(certRef);
    if (!material) {
      log.warn('signing/pades', `No signing cert configured for "${certRef}" — artifact passed through unsigned`);
      return { ...rendered };
    }
    if (!material.p12Buffer) {
      log.warn('signing/pades', `PAdES requires a PKCS#12 bundle — no p12Buffer in cert "${certRef}" — artifact passed through unsigned`);
      return { ...rendered };
    }

    try {
      const signedBytes = await this.signPdf(rendered.bytes, material);
      log.info('signing/pades', `PAdES-B signed ${rendered.syntax} with cert "${certRef}" (${signedBytes.length} bytes)`);
      return {
        ...rendered,
        bytes: new Uint8Array(signedBytes),
        signature: { algo: 'PAdES', certRef },
      };
    } catch (err) {
      log.warn('signing/pades', `PAdES signing failed for "${certRef}": ${(err as Error).message} — artifact passed through unsigned`);
      return { ...rendered };
    }
  }

  private async signPdf(pdfBytes: Uint8Array, material: SigningCredentialsMaterial): Promise<Buffer> {
    // Load the PDF and add a PKCS7 signature placeholder via pdf-lib.
    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    await pdflibAddPlaceholder({
      pdfDoc,
      reason: 'Digital Signature',
      contactInfo: '',
      name: 'Invoicerr',
      location: '',
      // Placeholder size for the PKCS#7 envelope (8192 hex chars = 4096 bytes signature).
      signatureLength: 4096,
    });
    const pdfWithPlaceholder = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));

    // Sign the PDF with the PKCS#12 bundle.
    const signer = new P12Signer(material.p12Buffer!, {
      passphrase: material.p12Password ?? '',
    });
    const signPdf = new SignPdf();
    return signPdf.sign(pdfWithPlaceholder, signer);
  }
}

// ---------------------------------------------------------------------------
// None / pass-through provider
// ---------------------------------------------------------------------------

/** No-op signer for post-audit / non-signed regimes (still a first-class provider). */
export class NoSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'none';
  async sign(rendered: RenderedArtifact): Promise<SignedArtifact> {
    return { ...rendered };
  }
}
