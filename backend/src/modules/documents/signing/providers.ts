/**
 * Real cryptographic signing providers for XAdES, CAdES, PAdES, and the none pass-through — reprised
 * from the repère (`avant-refonte-documents`, `compliance/providers/signing/providers.ts`) almost
 * verbatim: xadesjs, node-forge, @signpdf, pkijs are ALL already dependencies (see backend/package.json
 * — nothing new was added for this task), and the crypto itself (RSA import, XML/PKCS#7/PDF signing,
 * RFC 3161 timestamp embedding) is untouched. What changed is only the SHAPE this module hands
 * around: `RenderedArtifact`/`SignedArtifact` (a whole compliance-plan artifact, with a `role` and a
 * closed `DocumentSyntax`) became this module's own `SigningArtifact`/`SignedArtifact`
 * (`signing-types.ts`), and `ComplianceLogger` became `SigningLogger` (`signing-logger.ts`) — see
 * each file's own header for why. XAdES and CAdES are otherwise byte-for-byte the repère's own logic.
 *
 * Security rules enforced here (unchanged from the repère):
 *  - Private key / p12 password is NEVER logged (not even at debug level).
 *  - If no credential is resolved, the artifact is returned unsigned with a warn log.
 *  - No ASN.1 or crypto primitives are hand-rolled — only maintained libraries are used.
 *
 * Signature levels (see signing-types.ts's own SignatureLevel header):
 *  BES  — Basic signature.  Default; byte-identical to the previous behaviour.
 *  T    — Adds an RFC 3161 SignatureTimeStamp via the injected TsaPort.
 *  LT/LTA — Accepted but treated as T until revocation embedding is implemented (documented seam).
 *
 * TSA is opt-in: passing no TsaPort (or NullTsaClient) always produces BES output.
 *
 * ONE DELIBERATE DEPARTURE FROM THE REPÈRE, in `PadesSigningProvider` only — see that class's own
 * header for the full reasoning: root TODO item 13 requires that a company with an ACTIVE, applicable
 * certificate never receive a silently-unsigned PDF because the crypto operation itself blew up (a
 * corrupt PFX only discoverable at sign time, a library error) — the repère's blanket
 * try/catch-and-warn swallowed that case identically to "no cert configured", which is no longer
 * acceptable for the ONE algorithm actually wired to a live flow (`rendering/sign-instance-pdf.ts`).
 * XAdES and CAdES keep the repère's graceful-swallow contract verbatim — neither is wired to any flow
 * today (see registry.ts's own header), so only PAdES's real-world behavior matters end-to-end.
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

import { SigningLogger } from './signing-logger';
import { SignedArtifact, SigningArtifact } from './signing-types';
import { SignAlgo, SignatureLevel, SigningProvider } from './signing-provider';
import {
  NullSigningCredentials,
  SigningCredentialsMaterial,
  SigningCredentialsPort,
} from './signing-credentials-port';
import { NullTsaClient, SHA256_OID, TsaPort } from './tsa-client';

/** Options shared by all timestamp-capable providers. */
export interface TimestampOptions {
  /**
   * Desired signature level.  Default: 'BES' (no timestamp).
   * LT / LTA are accepted but treated as T until revocation material embedding is added.
   */
  signatureLevel?: SignatureLevel;
  /**
   * TSA client to use for -T level.  Default: NullTsaClient (offline-safe).
   * When null/absent the provider always produces BES-level output.
   */
  tsa?: TsaPort;
}

// ---------------------------------------------------------------------------
// One-time DOM + WebCrypto engine setup for xmldsigjs / xadesjs.
//
// xmldsigjs and xadesjs each bundle their own copy of xml-core, so we must
// call setNodeDependencies on BOTH instances.  We resolve the xmldsigjs copy
// at runtime via require.resolve so we don't hard-code a nested path.
//
// Node.js 18+ provides globalThis.crypto; @xmldom/xmldom provides DOMParser.
// ---------------------------------------------------------------------------
let _engineInitialised = false;
/** Exported so `transports/face/wsse-sign.ts` (WS-Security SOAP envelope signing) can reuse the SAME
 *  one-time DOM+WebCrypto engine setup rather than a second, drifting copy — that file needs
 *  `xmldsigjs`'s own `Parse()` (via `xml-core`'s `getNodeDependency('DOMParser')`) to hand
 *  `XmlDsigExcC14NTransform`/`SignedXml` DOM nodes typed as the AMBIENT global `Document`/`Element`
 *  (what those classes' own `.d.ts` declare), rather than `@xmldom/xmldom`'s own module-scoped
 *  `Document`/`Element` types — see that file's own header for why this specific type boundary
 *  matters here and nowhere else in this module. */
export function ensureXmlCryptoEngine(): void {
  if (_engineInitialised) return;

  const xmlDomDeps = { DOMParser, XMLSerializer } as Parameters<typeof setNodeDependencies>[0];

  // 1. Set DOM deps on xadesjs's bundled xml-core.
  setNodeDependencies(xmlDomDeps);

  // 2. Set DOM deps on xmldsigjs's bundled xml-core (a separate module instance).
  const path = require('node:path') as typeof import('path');
  const xmldsigDir = path.dirname(require.resolve('xmldsigjs'));
  const xmldsigXmlCore = require(require.resolve('xml-core', { paths: [xmldsigDir] })) as {
    setNodeDependencies: typeof setNodeDependencies;
  };
  xmldsigXmlCore.setNodeDependencies(xmlDomDeps);

  // 3. Register native Node.js Web Crypto API as the signing engine for xmldsigjs.
  XmldsigApp.setEngine('native', globalThis.crypto as Crypto);

  _engineInitialised = true;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// RSA PKCS#1 v1.5 with SHA-256 — covers the majority of PKI certs in use. Exported: `wsse-sign.ts`
// deliberately uses the SAME algorithm choice for its own RSA-SHA256 WS-Security signature (see that
// file's own header on why SHA-256, not a fresh decision made twice).
export const RSA_ALGO: RsaHashedImportParams = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

/**
 * Import a PKCS#8 PEM private key as a WebCrypto CryptoKey (RSASSA-PKCS1-v1_5/SHA-256).
 * Exported for `wsse-sign.ts` — see this file's own header, `RSA_ALGO`'s own comment.
 */
export async function importPrivateKeyPem(pem: string): Promise<CryptoKey> {
  const pemBody = pem.replace(/-----BEGIN[^-]*-----|-----END[^-]*-----|\r?\n/g, '');
  const der = Buffer.from(pemBody, 'base64');
  return crypto.subtle.importKey('pkcs8', der, RSA_ALGO, false, ['sign']);
}

/**
 * Extract the SubjectPublicKeyInfo (SPKI) bytes from a DER-encoded X.509 certificate
 * using node-forge, then import as a WebCrypto CryptoKey. Exported for `wsse-sign.ts` — its own local
 * signature re-verification needs the SAME public-key extraction, from the certificate embedded in
 * the `wsse:BinarySecurityToken` itself, not a certificate handed to it out of band.
 */
export async function importPublicKeyFromCertDer(certDer: Buffer): Promise<CryptoKey> {
  const certAsn1 = forge.asn1.fromDer(forge.util.binary.raw.encode(new Uint8Array(certDer)));
  const forgeCert = forge.pki.certificateFromAsn1(certAsn1);
  const spkiAsn1 = forge.pki.publicKeyToAsn1(forgeCert.publicKey as forge.pki.rsa.PublicKey);
  const spkiDer = Buffer.from(forge.asn1.toDer(spkiAsn1).getBytes(), 'binary');
  return crypto.subtle.importKey('spki', spkiDer, RSA_ALGO, true, ['verify']);
}

// ---------------------------------------------------------------------------
// RFC 3161 timestamp embedding helpers
// ---------------------------------------------------------------------------

/** XAdES namespace URI (ETSI EN 319 132 / TS 101 903 v1.3.2) */
const XADES_NS = 'http://uri.etsi.org/01903/v1.3.2#';
/** CAdES id-aa-signatureTimeStampToken OID (RFC 5652 / ETSI EN 319 122) */
const CADES_TIMESTAMP_OID = '1.2.840.113549.1.9.16.2.14';

/**
 * XAdES-T: insert a SignatureTimeStamp into the QualifyingProperties of an already-signed XML.
 * The timestamp covers the SHA-256 hash of the raw (base64-decoded) ds:SignatureValue bytes,
 * per ETSI EN 319 132 §5.5.
 *
 * Returns the original xmlString unchanged when the TSA returns null (BES fall-through).
 */
async function applyTimestampXades(xmlString: string, tsa: TsaPort): Promise<string> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  const sigValues = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'SignatureValue');
  if (sigValues.length === 0) return xmlString;

  const sigValueB64 = (sigValues[0].textContent ?? '').replace(/\s/g, '');
  const sigValueBytes = Buffer.from(sigValueB64, 'base64');

  const digestAb = await crypto.subtle.digest('SHA-256', sigValueBytes);
  const tst = await tsa.timestamp(Buffer.from(digestAb), SHA256_OID);
  if (!tst) return xmlString; // TSA unavailable → BES fall-through

  // Find the xades:QualifyingProperties element to append UnsignedProperties to.
  const qualifyingProps = doc.getElementsByTagNameNS(XADES_NS, 'QualifyingProperties');
  if (qualifyingProps.length === 0) return xmlString;

  const qp = qualifyingProps[0];

  const unsignedProps = doc.createElementNS(XADES_NS, 'xades:UnsignedProperties');
  const unsignedSigProps = doc.createElementNS(XADES_NS, 'xades:UnsignedSignatureProperties');
  const sigTimestamp = doc.createElementNS(XADES_NS, 'xades:SignatureTimeStamp');
  const encapsulated = doc.createElementNS(XADES_NS, 'xades:EncapsulatedTimeStamp');

  encapsulated.textContent = tst.toString('base64');
  sigTimestamp.appendChild(encapsulated);
  unsignedSigProps.appendChild(sigTimestamp);
  unsignedProps.appendChild(unsignedSigProps);
  qp.appendChild(unsignedProps);

  return new XMLSerializer().serializeToString(doc);
}

/**
 * CAdES-T: append an id-aa-signatureTimeStampToken unsigned attribute to the SignerInfo
 * of an already-signed PKCS#7 / CAdES-BES DER buffer.
 * The timestamp covers the SHA-256 hash of the SignerInfo.signature (OCTET STRING) bytes,
 * per ETSI EN 319 122 §5.5.
 *
 * Returns the original p7mDer unchanged when the TSA returns null (BES fall-through).
 */
async function applyTimestampCades(p7mDer: Buffer, tsa: TsaPort): Promise<Buffer> {
  // Re-parse the DER to navigate the ASN.1 tree.
  const parsed = forge.asn1.fromDer(p7mDer.toString('binary'));

  // ContentInfo > [0] EXPLICIT > SignedData
  const signedData = (parsed.value as forge.asn1.Asn1[])[1].value[0] as forge.asn1.Asn1;

  // signerInfos = last SET in SignedData (digestAlgorithms is the first SET)
  const sdChildren = signedData.value as forge.asn1.Asn1[];
  let signerInfosSet: forge.asn1.Asn1 | null = null;
  for (let i = sdChildren.length - 1; i >= 0; i--) {
    if (sdChildren[i].type === forge.asn1.Type.SET) {
      signerInfosSet = sdChildren[i];
      break;
    }
  }
  if (!signerInfosSet) return p7mDer;

  const signerInfo = (signerInfosSet.value as forge.asn1.Asn1[])[0];
  if (!signerInfo) return p7mDer;

  // Signature value = last OCTET STRING in SignerInfo
  const siChildren = signerInfo.value as forge.asn1.Asn1[];
  let sigOctet: forge.asn1.Asn1 | null = null;
  for (let i = siChildren.length - 1; i >= 0; i--) {
    if (siChildren[i].type === forge.asn1.Type.OCTETSTRING) {
      sigOctet = siChildren[i];
      break;
    }
  }
  if (!sigOctet) return p7mDer;

  const sigBytes = Buffer.from(sigOctet.value as string, 'binary');
  const digestAb = await crypto.subtle.digest('SHA-256', sigBytes);
  const tst = await tsa.timestamp(Buffer.from(digestAb), SHA256_OID);
  if (!tst) return p7mDer; // TSA unavailable → BES fall-through

  // Build [1] IMPLICIT unsignedAttrs containing id-aa-signatureTimeStampToken.
  // The attribute value is the TST ContentInfo DER (a SEQUENCE), not an OctetString.
  const unsignedAttrs = forge.asn1.create(
    forge.asn1.Class.CONTEXT_SPECIFIC,
    1, // [1] IMPLICIT
    true,
    [
      forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SEQUENCE, true, [
        forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.OID,
          false,
          forge.asn1.oidToDer(CADES_TIMESTAMP_OID).getBytes(),
        ),
        forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, [
          forge.asn1.fromDer(tst.toString('binary')), // TST ContentInfo
        ]),
      ]),
    ],
  );

  siChildren.push(unsignedAttrs);

  return Buffer.from(forge.asn1.toDer(parsed).getBytes(), 'binary');
}

// ---------------------------------------------------------------------------
// XAdES provider — enveloped XAdES-BES over XML documents. NOT wired to any flow today (no channel
// in this product needs it — see registry.ts's own header); reprised, tested, registered so the
// capability exists the day one does.
// ---------------------------------------------------------------------------

export class XadesSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'XAdES';

  private readonly signatureLevel: SignatureLevel;
  private readonly tsa: TsaPort;

  constructor(
    private readonly credentials: SigningCredentialsPort = new NullSigningCredentials(),
    options: TimestampOptions = {},
  ) {
    this.signatureLevel = options.signatureLevel ?? 'BES';
    this.tsa = options.tsa ?? new NullTsaClient();
  }

  async sign(artifact: SigningArtifact, certRef: string, log: SigningLogger): Promise<SignedArtifact> {
    const material = await this.credentials.resolve(certRef);
    if (!material) {
      log.warn(
        'signing/xades',
        `No signing cert configured for "${certRef}" — artifact passed through unsigned`,
      );
      return { ...artifact };
    }

    try {
      ensureXmlCryptoEngine();

      const xmlString = Buffer.from(artifact.bytes).toString('utf-8');
      const xmlDoc = XmlParse(xmlString);

      const [privateKey, publicKey] = await Promise.all([
        importPrivateKeyPem(material.privateKeyPem),
        importPublicKeyFromCertDer(material.certDer),
      ]);

      const signedXml = new SignedXml();
      await signedXml.Sign(RSA_ALGO, privateKey, xmlDoc, {
        keyValue: publicKey,
        references: [{ hash: 'SHA-256', transforms: ['enveloped'] }],
      });

      // Apply RFC 3161 timestamp when level ≥ T and a TSA is wired up.
      let signedXmlString = signedXml.toString();
      if (this.signatureLevel !== 'BES') {
        signedXmlString = await applyTimestampXades(signedXmlString, this.tsa);
      }

      const signedBytes = Buffer.from(signedXmlString, 'utf-8');
      const level = this.signatureLevel !== 'BES' ? `-${this.signatureLevel}` : '-BES';
      log.info(
        'signing/xades',
        `XAdES${level} signed ${artifact.label ?? artifact.mime} with cert "${certRef}" (${signedBytes.length} bytes)`,
      );
      return {
        ...artifact,
        bytes: new Uint8Array(signedBytes),
        signature: { algo: 'XAdES', certRef },
      };
    } catch (err) {
      log.warn(
        'signing/xades',
        `XAdES signing failed for "${certRef}": ${(err as Error).message} — artifact passed through unsigned`,
      );
      return { ...artifact };
    }
  }
}

// ---------------------------------------------------------------------------
// CAdES provider — CAdES-BES PKCS#7 (.p7m) enveloping signature. NOT wired to any flow today — see
// registry.ts's own header (SdI accepts CAdES but that channel is not accredited, TODO.md item 10).
// ---------------------------------------------------------------------------

export class CadesSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'CAdES';

  private readonly signatureLevel: SignatureLevel;
  private readonly tsa: TsaPort;

  constructor(
    private readonly credentials: SigningCredentialsPort = new NullSigningCredentials(),
    options: TimestampOptions = {},
  ) {
    this.signatureLevel = options.signatureLevel ?? 'BES';
    this.tsa = options.tsa ?? new NullTsaClient();
  }

  async sign(artifact: SigningArtifact, certRef: string, log: SigningLogger): Promise<SignedArtifact> {
    const material = await this.credentials.resolve(certRef);
    if (!material) {
      log.warn(
        'signing/cades',
        `No signing cert configured for "${certRef}" — artifact passed through unsigned`,
      );
      return { ...artifact };
    }

    try {
      let p7mBytes = await this.signWithForge(artifact.bytes, material);

      // Apply RFC 3161 timestamp when level ≥ T and a TSA is wired up.
      if (this.signatureLevel !== 'BES') {
        p7mBytes = await applyTimestampCades(p7mBytes, this.tsa);
      }

      const level = this.signatureLevel !== 'BES' ? `-${this.signatureLevel}` : '-BES';
      log.info(
        'signing/cades',
        `CAdES${level} signed ${artifact.label ?? artifact.mime} with cert "${certRef}" (${p7mBytes.length} bytes .p7m)`,
      );
      return {
        ...artifact,
        bytes: new Uint8Array(p7mBytes),
        mime: 'application/pkcs7-mime',
        signature: { algo: 'CAdES', certRef },
      };
    } catch (err) {
      log.warn(
        'signing/cades',
        `CAdES signing failed for "${certRef}": ${(err as Error).message} — artifact passed through unsigned`,
      );
      return { ...artifact };
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
      ],
    });
    p7.sign({ detached: false });

    const asn1 = p7.toAsn1();
    const derString = forge.asn1.toDer(asn1).getBytes();
    return Buffer.from(derString, 'binary');
  }
}

// ---------------------------------------------------------------------------
// PAdES provider — PAdES-B signature embedded in PDF. THE ONE ALGORITHM WIRED TO A LIVE FLOW
// (rendering/sign-instance-pdf.ts) — see this class's own error-handling contract below, which is
// the one deliberate departure from the repère (see this file's own top-of-file header).
// ---------------------------------------------------------------------------

export class PadesSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'PAdES';

  private readonly signatureLevel: SignatureLevel;

  constructor(
    private readonly credentials: SigningCredentialsPort = new NullSigningCredentials(),
    options: TimestampOptions = {},
  ) {
    this.signatureLevel = options.signatureLevel ?? 'BES';
    // NOTE: PAdES document timestamp (ISO 32000-2 §12.8.5) requires adding a separate
    // signature revision after the main signature, which is outside the scope of
    // @signpdf/signpdf's placeholder-fill model. PAdES-T is a documented seam:
    // the signatureLevel is stored and logged but the output is equivalent to PAdES-B
    // until a dedicated PDF timestamp revision layer is added.
    void options.tsa; // tsa is accepted for API consistency but unused here
  }

  /**
   * Resolution and signing are split into two distinct failure modes, DELIBERATELY treated
   * differently (see this file's own top-of-file header for why this provider departs from the
   * repère here):
   *
   *  1. No cert configured for `certRef`, or the resolved material has no `p12Buffer` (PAdES cannot
   *     sign without one — there is no PEM fallback the way XAdES/CAdES have): this is "signing was
   *     never really requested" — warn and pass the artifact through unsigned, exactly like every
   *     other provider in this file.
   *
   *  2. A `p12Buffer` WAS resolved (the company DID configure and activate a certificate applicable
   *     to PAdES) but the actual cryptographic operation throws — a corrupt PFX only discoverable at
   *     sign time, a wrong password that slipped past upload-time validation, a library error: this
   *     is "signing was requested and failed", and it is RETHROWN, never swallowed into a silent
   *     unsigned pass-through. A company that turned signing on gets a loud 500 on that one document
   *     instead of an invoice it believes is signed but is not — see `sign-instance-pdf.ts`'s own
   *     header and `sign-instance-pdf.spec.ts`'s "signing failure is loud" coverage.
   */
  async sign(artifact: SigningArtifact, certRef: string, log: SigningLogger): Promise<SignedArtifact> {
    const material = await this.credentials.resolve(certRef);
    if (!material) {
      log.warn(
        'signing/pades',
        `No signing cert configured for "${certRef}" — artifact passed through unsigned`,
      );
      return { ...artifact };
    }
    if (!material.p12Buffer) {
      log.warn(
        'signing/pades',
        `PAdES requires a PKCS#12 bundle — no p12Buffer in cert "${certRef}" — artifact passed through unsigned`,
      );
      return { ...artifact };
    }

    try {
      const signedBytes = await this.signPdf(artifact.bytes, material);
      const level = this.signatureLevel !== 'BES' ? `-${this.signatureLevel}(seam/B)` : '-B';
      log.info(
        'signing/pades',
        `PAdES${level} signed ${artifact.label ?? artifact.mime} with cert "${certRef}" (${signedBytes.length} bytes)`,
      );
      return {
        ...artifact,
        bytes: new Uint8Array(signedBytes),
        signature: { algo: 'PAdES', certRef },
      };
    } catch (err) {
      // See this method's own header, case 2: an active, applicable cert failed to actually sign —
      // this is never swallowed into "unsigned". `log.error` first, so the failure is visible in
      // logs even though the caller (sign-instance-pdf.ts) will also see the thrown error.
      log.error(
        'signing/pades',
        `PAdES signing FAILED for "${certRef}" despite an active certificate: ${(err as Error).message}`,
      );
      throw err;
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

/** No-op signer for a company with no signing capability configured (still a first-class provider —
 *  `registry.ts#SigningProviderRegistry.get` falls back to this for any unknown algo). */
export class NoSigningProvider implements SigningProvider {
  readonly algo: SignAlgo = 'none';
  async sign(artifact: SigningArtifact): Promise<SignedArtifact> {
    return { ...artifact };
  }
}
