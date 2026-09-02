/**
 * The "face" transport — Spain's B2G invoice entry point (FACe, Ley 25/2013 — see
 * `b2g-routing/data/es.json`'s own header for the article-level citation), the channel that rule
 * names since this task. Same `DocumentTransport` interface every sibling transport implements,
 * registered the same way (`TransportRegistry.register`, `documents-core.module.ts`).
 *
 * The client (`face/face-client.ts`) is REPRISED from git tag `avant-refonte-documents`
 * (`compliance/providers/transmission/face-client.ts` + `face-transmission.ts`) — see that file's own
 * header for exactly what was kept verbatim, what changed (xmlbuilder2 envelope building, matching
 * `sdi/sdicoop-client.ts`'s own convention), and what is RE-VERIFIED vs merely carried forward. This
 * transport's OWN job is the orchestration around it — resolving credentials, gating on the DIR3
 * triad, building the SIGNED Facturae payload, and enforcing the hard-success contract — the same
 * split `chorus-pro-transport.ts`/`anaf-transport.ts` already hold between "the client speaks the
 * platform's wire protocol" and "the transport drives it".
 *
 * ## THE SOAP TRANSPORT ITSELF — what is real, what is extrapolated
 *
 * `FaceSoapHttpPort` (below) is a REAL `node:https` POST, modelled on `sdi/sdicoop-client.ts`'s own
 * `postSoap` helper (same file the task's own brief points at as the template for "enveloppes via
 * xmlbuilder2") — not a stub.
 *
 *  1. **The SOAP envelope IS NOW WS-Security-signed (2026-09-02 task)** — `face/wsse-sign.ts` builds
 *     the `wsse:Security` header (BinarySecurityToken + `ds:Signature` over the `soapenv:Body` +
 *     `KeyInfo`/`SecurityTokenReference`), per the OASIS X.509 Certificate Token Profile — see that
 *     file's own header for the cited form, what is extrapolated, and why `xmldsigjs`'s high-level
 *     `SignedXml.Sign()` could not be used as-is. Before this task, `face-client.ts`'s header
 *     explained why building a signature a live SSPP server would ACCEPT could not be settled offline
 *     — that is STILL true (no FACe-registered certificate exists in this checkout to prove full
 *     acceptance), but the NARROWER, live-provable claim — that a WS-Security-signed envelope makes
 *     the sandbox's OWN fault CHANGE NATURE (from "no está firmada" to something else) — is exactly
 *     what this task's own report documents, both ways, with the raw server responses. When NO
 *     signing certificate is configured (see `FaceTransportDeps.signingCredentials` below), `send()`
 *     now refuses OUTRIGHT rather than falling back to the old unsigned behaviour — see "THE
 *     WS-SECURITY CERTIFICATE" below for the resolution and gate-ordering reasoning.
 *  2. **The company's certificate IS ALSO offered as the TLS client certificate (mTLS)**, purely as a
 *     defensive extrapolation — `face-client.ts`'s own header flags this as an open question
 *     ("NOT mutual TLS" per the sources it read, but not certain). Offering it costs nothing when the
 *     server does not ask for a client cert (a plain TLS server ignores an unsolicited client cert),
 *     and may help if it turns out FACe's SSPP endpoint DOES gate at the TLS layer too. This is never
 *     presented as "the auth mechanism" — the header comment on `postFace` names it as a guess. NOTE:
 *     this mTLS certificate is the FACe CHANNEL's OWN PKCS12 (`FaceCredentials.certificate`,
 *     `channels.service.ts`), a SEPARATE credential object from the WS-Security certificate below —
 *     see that section for the acknowledged gap this creates.
 *
 * ## THE WS-SECURITY CERTIFICATE — why it is the SAME cert as the Facturae document's own XAdES one
 *
 * `certRefFor(companyId)` (`formats/national/facturae-provider.ts`, exported for exactly this reuse)
 * resolves `"{companyId}:XAdES"` from the SAME `SigningCredentialsPort`
 * (`SigningCertificatesService` in production) that `facturaeFormatProvider.build()` ALREADY resolved
 * a moment earlier to XAdES-sign the Facturae document itself. This is DELIBERATE, not a shortcut: in
 * reality a company presents ONE FNMT (or equivalent) certificate for BOTH the document's OWN
 * signature and the SOAP transport's WS-Security signature — they are the SAME accredited identity,
 * just applied at two different layers. Reusing the resolution this codebase ALREADY has for that
 * identity is more honest than inventing a THIRD, differently-scoped credential slot no real company
 * would separately populate.
 *
 * ACKNOWLEDGED GAP: this is DIFFERENT from the FACe CHANNEL's OWN certificate (`FaceCredentials`
 * above, used for mTLS) — a company could, today, configure a DIFFERENT PKCS12 in "Company settings →
 * Channels → FACe" than the one active under "Company settings → Signing certificates" (applicability
 * "XAdES" or "*"). A real, working FACe deposit needs these to be the SAME physical certificate (mTLS
 * identity and WS-Security signer must agree) — this codebase does not enforce that today. Named here,
 * not silently assumed away; unifying the two credential slots is a SEPARATE, larger product decision
 * this task does not make.
 *
 * GATE ORDER (this task's own "vérifie l'ordre des gates" requirement): `facturaeFormatProvider
 * .build()` ALREADY throws `FacturaeSigningRequiredError` when no `"{companyId}:XAdES"` cert resolves
 * (`facturae-provider.ts`'s own header, "point 3") — BEFORE `send()` ever reaches the WS-Security
 * resolution below, let alone the network. So "no certificate at all" was ALREADY a hard refusal
 * before this task; this task ADDS a symmetric guard for the (only reachable via independently-mocked
 * dependencies, since `facturaeFormatProvider`/`signingCredentials` are two SEPARATE constructor
 * params) case where the Facturae build somehow succeeded but the SECOND resolve, for WS-Security,
 * comes back empty — refused too, never silently sent unsigned (see `face-transport.spec.ts`'s own
 * "WS-SECURITY GATE" tests).
 *
 * ## THE DIR3 GATE — mirrors `chorus-pro-transport.ts`'s own "no SIRET on file" guard
 *
 * The B2G ES rule's own `requiredClientIdentifiers`/`requiredDocumentFields`
 * (`b2g-routing/data/es.json`) are already checked upstream by `invoice-actions.ts`'s B2G preflight
 * for a client actually routed through the B2G mechanism — but a company that picked "face" as its
 * OWN free `invoiceTransportId` for a client that never went through that gate at all (the registry
 * is open by design, see `transport-registry.ts`'s own header) gets NO such upstream check. This
 * transport closes that gap itself, the same way Chorus Pro's own SIRET gate does: before ever
 * calling FACe, the three DIR3 document fields (`data.dir3OrganoGestor`/`dir3UnidadTramitadora`/
 * `dir3OficinaContable` — the SAME keys `formats/national/facturae-provider.ts` reads to build
 * `<AdministrativeCentres>`) must ALL be present, refused, named, otherwise — never a deposit
 * attempted with no way to route it once it arrives at the recipient AAPP.
 *
 * Two distinct failure shapes, both loud, neither silent — same split every transport in this
 * directory documents:
 *  - `preflight()` — no FACe channel connected for this company (or an incomplete config) — thrown
 *    BEFORE anything is persisted or queued.
 *  - `send()` — connected, but the DIR3 triad is missing, the Facturae build/signature gate fails
 *    (`FacturaeSigningRequiredError` — see `facturae-provider.ts`'s own header), or the deposit
 *    itself fails (SOAP fault, network error, or FACe answering with no usable `numeroRegistro`) —
 *    thrown from inside `deliver()`, so BullMQ's own retries get a chance to run before this ever
 *    becomes `send_failed`.
 * An accepted `enviarFactura` with an EMPTY `numeroRegistro` is the SECOND kind of failure, never a
 * success — this task's own mutation #2 target, the same hard-success contract every transport in
 * this directory already enforces (LIVE_TESTING.md: "a reference nobody can look up is not a
 * reference at all").
 *
 * Post-deposit conformity: `consultarFactura` is exactly the kind of pull endpoint
 * `conformity/authority-status-poller.ts` exists for — `conformity/pollers/face-status-poller.ts`
 * registers one, the same shape `chorus-pro-status-poller.ts`/`anaf-status-poller.ts` already hold —
 * the repère's own `FaceTransmissionProvider.poll()` had one (see that file's own header), so this is
 * carried forward, not invented.
 */
import * as https from 'node:https';
import { URL } from 'node:url';

import { BadRequestException, NotImplementedException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';
import prisma from '@/prisma/prisma.service';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentFormatBuildResult, DocumentFormatProvider } from '../formats/format-provider';
import { clientToFormatParty, companyToFormatParty } from '../formats/party-snapshot';
import { certRefFor, FacturaeSigningRequiredError } from '../formats/national/facturae-provider';
import { SigningCredentialsPort } from '../signing/signing-credentials-port';
import { FACE_ENDPOINTS, FaceClient, FaceHttpPort } from './face/face-client';
import { buildUnsignedEnvelope, signSoapEnvelope, WsseCertificate } from './face/wsse-sign';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

export interface FaceTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The Facturae provider (`formats/national/facturae-provider.ts`) — the ONLY payload this
   *  transport ever deposits, XSD-gated and XAdES-signed before this file ever sees the bytes. */
  facturaeFormatProvider: DocumentFormatProvider;
  /** Root TODO item 13's own port (`SigningCertificatesService` in production) — see this file's own
   *  header, "THE WS-SECURITY CERTIFICATE", for why the SOAP transport layer resolves the EXACT SAME
   *  `"{companyId}:XAdES"` cert `facturaeFormatProvider` already required a moment earlier, rather
   *  than a second, independent credential. */
  signingCredentials: SigningCredentialsPort;
}

export const FACE_PROVIDER_ID = 'face';

/** Same "the invoice's OWN base descriptor, module-level constant" choice every sibling transport
 *  makes — see `pdp-transport.ts`'s own header. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/** The three DIR3 document fields — see this file's own header, "THE DIR3 GATE", and
 *  `formats/national/facturae-provider.ts`'s own `DIR3_FIELDS` (the SAME keys, never redeclared as a
 *  second source of truth — this array only carries the human-facing label for the refusal message). */
const DIR3_FIELDS: { field: string; label: string }[] = [
  { field: 'dir3OrganoGestor', label: 'Órgano Gestor' },
  { field: 'dir3UnidadTramitadora', label: 'Unidad Tramitadora' },
  { field: 'dir3OficinaContable', label: 'Oficina Contable' },
];

export interface FaceCredentials {
  /** PKCS#12 (base64) — see this file's own header on why this is ALSO offered as a TLS client cert
   *  (extrapolated), independent of the (not implemented) WS-Security signature it is really for. */
  certificate: string;
  certificatePassword: string;
  /** 'correo' — the SSPP contract's own mandatory notification email (`face-client.ts`). */
  notificationEmail: string;
}

/** Extracts and validates the three fields this transport actually needs — shared by `preflight()`
 *  and `send()` so neither can drift, same discipline every sibling transport's own
 *  `extractCredentials` holds. */
export function extractFaceCredentials(resolved: ResolvedChannelConfig): FaceCredentials | null {
  const { certificate, certificatePassword, notificationEmail } = resolved.config;
  if (typeof certificate !== 'string' || !certificate) return null;
  if (typeof certificatePassword !== 'string' || !certificatePassword) return null;
  if (typeof notificationEmail !== 'string' || !notificationEmail) return null;
  return { certificate, certificatePassword, notificationEmail };
}

async function requireConnectedFace(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<{ credentials: FaceCredentials; environment: string }> {
  const resolved = await channelCredentials.resolveActive(companyId, FACE_PROVIDER_ID);
  const credentials = resolved && extractFaceCredentials(resolved);
  if (!resolved || !credentials) {
    logger.warn('FACe transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The FACe channel is not connected for this company (a FACe-registered PKCS#12 certificate, ' +
        'its password, and a notification email are all required). Connect it in company settings ' +
        '(Channels → FACe) before sending an invoice through it — there is no default channel. See ' +
        'CREDENTIALS_GUIDE.md §20 for how to obtain a FACe-registered certificate.',
    );
  }
  return { credentials, environment: resolved.environment };
}

function resolveEndpoint(environment: string): string {
  return environment === 'PROD' ? FACE_ENDPOINTS.prod : FACE_ENDPOINTS.test;
}

/**
 * REAL `node:https` SOAP transport — see this file's own header, "THE SOAP TRANSPORT ITSELF", for
 * what is genuinely implemented (the envelope, the POST, mTLS-offered-defensively, and — as of this
 * task — the WS-Security signature). Wraps `face-client.ts`'s own operation FRAGMENT into a full
 * `soap:Envelope` — the exact seam `FaceHttpPort`'s own doc comment describes a real implementation
 * filling in — signed via `wsse-sign.ts` when a `wsseCertificate` is configured, UNSIGNED (the
 * pre-task shape, kept for a company with no WS-Security cert resolved — see this file's own header,
 * "THE WS-SECURITY CERTIFICATE") otherwise.
 */
export class FaceSoapHttpPort implements FaceHttpPort {
  constructor(
    private readonly pfx?: Buffer,
    private readonly passphrase?: string,
    private readonly timeoutMs = 30_000,
    /** WS-Security signing certificate — see this file's own header, "THE WS-SECURITY CERTIFICATE",
     *  for where this is resolved. `undefined` → the envelope is sent UNSIGNED, same as every call
     *  before this task (a caller that has not been updated to pass one, or a test exercising the
     *  regression path — see `face-transport.spec.ts`'s own "stub still behaves as before" case). */
    private readonly wsseCertificate?: WsseCertificate,
    /** Test-only: trust an additional CA (a local stub server's own self-signed cert) WITHOUT
     *  weakening `rejectUnauthorized` globally — the SAME reasoning `sdicoop-client.ts`'s own `ca`
     *  config option already documents. `undefined` in every real caller (`buildFaceClient`), which
     *  relies on Node's default trust store, the correct posture for the real FACe host. */
    private readonly ca?: string | Buffer,
  ) {}

  async post(endpoint: string, operation: string, body: string): Promise<{ status: number; data: string }> {
    const envelope = this.wsseCertificate
      ? (await signSoapEnvelope(body, this.wsseCertificate)).envelope
      : buildUnsignedEnvelope(body);

    return new Promise((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(endpoint);
      } catch (err) {
        reject(new Error(`FACe endpoint is not a valid URL: ${(err as Error).message}`));
        return;
      }

      try {
        const payload = Buffer.from(envelope, 'utf-8');
        const req = https.request(
          {
            hostname: url.hostname,
            port: url.port ? Number(url.port) : 443,
            path: url.pathname || '/',
            method: 'POST',
            // Offered defensively — see this file's own header, point 2. A server that never asks
            // for a client cert simply ignores this.
            pfx: this.pfx,
            passphrase: this.passphrase,
            timeout: this.timeoutMs,
            ca: this.ca,
            headers: {
              'Content-Type': 'text/xml; charset=utf-8',
              'Content-Length': payload.length,
              SOAPAction: `"https://webservice.face.gob.es#${operation}"`,
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              resolve({ status: res.statusCode ?? 0, data: Buffer.concat(chunks).toString('utf-8') });
            });
            res.on('error', (err) => reject(new Error(`FACe response stream error: ${err.message}`)));
          },
        );
        req.on('timeout', () => {
          req.destroy(new Error(`FACe request timed out after ${this.timeoutMs}ms`));
        });
        req.on('error', (err) => reject(new Error(`FACe SOAP request failed: ${err.message}`)));
        req.write(payload);
        req.end();
      } catch (err) {
        reject(new Error(`FACe SOAP request failed: ${(err as Error).message}`));
      }
    });
  }
}

/** Builds a REAL `FaceClient` for this company's connected credentials — one instance per call, same
 *  "no shared, cross-request state beyond a short-lived call" choice every sibling transport's own
 *  client construction makes. Exported so `conformity/pollers/face-status-poller.ts` builds the
 *  identical client, never a second construction path that could drift from this one.
 *  `wsseCertificate` — see this file's own header, "THE WS-SECURITY CERTIFICATE" — is `undefined` for
 *  a caller that has none resolved; `FaceSoapHttpPort` then sends the envelope unsigned. */
export function buildFaceClient(
  credentials: FaceCredentials,
  environment: string,
  wsseCertificate?: WsseCertificate,
): FaceClient {
  const endpoint = resolveEndpoint(environment);
  const pfx = Buffer.from(credentials.certificate, 'base64');
  const httpPort = new FaceSoapHttpPort(pfx, credentials.certificatePassword, undefined, wsseCertificate);
  return new FaceClient({ endpoint }, httpPort);
}

export function buildFaceTransport(deps: FaceTransportDeps): DocumentTransport {
  return {
    async preflight(companyId: string): Promise<void> {
      await requireConnectedFace(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      // Re-resolved rather than trusting the preflight's own result — same reasoning every sibling
      // transport's own `send()` already documents.
      const { credentials, environment } = await requireConnectedFace(deps.channelCredentials, ctx.companyId);

      const data = (ctx.document.data ?? {}) as Record<string, unknown>;

      // THE DIR3 GATE — see this file's own header. Checked BEFORE any network call, same shape
      // Chorus Pro's own SIRET gate holds.
      const missingDir3 = DIR3_FIELDS.filter((f) => {
        const raw = data[f.field];
        return typeof raw !== 'string' || !raw.trim();
      });
      if (missingDir3.length > 0) {
        throw new BadRequestException(
          `Cannot deposit to FACe: the DIR3 routing codes are incomplete — missing ` +
            `${missingDir3.map((f) => `${f.label} (${f.field})`).join(', ')}. FACe routes an invoice ` +
            'inside the receiving public body by these three codes; set them on the invoice before ' +
            'sending — Ley 25/2013 names the general entry point, never a specific unit to deliver to.',
        );
      }

      const clientId = typeof data.client === 'string' ? data.client : undefined;
      const [company, client] = await Promise.all([
        prisma.company.findUnique({ where: { id: ctx.companyId }, include: { partyIdentifiers: true } }),
        clientId
          ? prisma.client.findUnique({ where: { id: clientId }, include: { partyIdentifiers: true } })
          : Promise.resolve(null),
      ]);
      if (!company) {
        throw new BadRequestException(`Company "${ctx.companyId}" not found.`);
      }
      if (!client) {
        throw new BadRequestException(
          `Cannot deposit to FACe: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      let buildResult: DocumentFormatBuildResult;
      try {
        buildResult = await deps.facturaeFormatProvider.build(
          INVOICE_DESCRIPTOR,
          ctx.document,
          companyToFormatParty(company),
          clientToFormatParty(client),
          ctx.companyId,
        );
      } catch (error) {
        // `FacturaeSigningRequiredError` — no XAdES certificate configured, or signing failed — see
        // `facturae-provider.ts`'s own header. Named, refused, never a silent unsigned deposit.
        if (error instanceof FacturaeSigningRequiredError) {
          throw new BadRequestException(`Cannot deposit to FACe: ${error.message}`);
        }
        throw error;
      }
      if (!buildResult.validation.valid) {
        // Same gate every sibling transport enforces for its own build — an artifact that fails the
        // vendored Facturae XSD is NEVER deposited, only refused, named.
        throw new BadRequestException({
          message: 'Cannot deposit to FACe: the generated Facturae document failed XSD validation.',
          errors: buildResult.validation.errors,
        });
      }

      // THE WS-SECURITY GATE — see this file's own header, "THE WS-SECURITY CERTIFICATE". Re-resolves
      // the SAME `"{companyId}:XAdES"` cert `facturaeFormatProvider.build()` (above) just proved
      // exists — genuinely redundant in production (same port, same certRef, same request), but
      // `facturaeFormatProvider`/`signingCredentials` are two INDEPENDENT constructor params with no
      // compile-time link, so this refuses OUTRIGHT rather than silently sending the SOAP envelope
      // unsigned in the one case they disagree (a misconfigured wiring, or a test double built that
      // way — see `face-transport.spec.ts`'s own "WS-SECURITY GATE" tests, this task's mutation guard).
      const signingMaterial = await deps.signingCredentials.resolve(certRefFor(ctx.companyId));
      if (!signingMaterial) {
        throw new BadRequestException(
          'Cannot deposit to FACe: no active XAdES-applicable signing certificate is configured for ' +
            'this company — FACe requires the SOAP transport itself to be WS-Security-signed, never ' +
            'sent unsigned. Add or fix a certificate at Company settings → Signing certificates ' +
            '(applicability "XAdES" or "*") before sending.',
        );
      }
      const wsseCertificate: WsseCertificate = {
        certDer: signingMaterial.certDer,
        privateKeyPem: signingMaterial.privateKeyPem,
      };

      const faceClient = buildFaceClient(credentials, environment, wsseCertificate);
      const facturaBase64 = Buffer.from(buildResult.bytes).toString('base64');
      const facturaNombre = `facturae-${ctx.document.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.xml`;

      logger.info('FACe: enviarFactura', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, environment, facturaNombre },
      });

      let numeroRegistro: string | undefined;
      try {
        const result = await faceClient.enviarFactura({
          correo: credentials.notificationEmail,
          facturaBase64,
          facturaNombre,
        });
        if (result.codigo !== '0') {
          throw new Error(`FACe rejected the submission — codigo ${result.codigo}: ${result.descripcion}`);
        }
        numeroRegistro = result.numeroRegistro;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('FACe enviarFactura failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` — see async-send.ts's own header: BullMQ's retries get
        // a chance to run before this ever becomes "send_failed".
        throw new BadRequestException(`FACe enviarFactura failed: ${message}`);
      }

      // MUTATION GUARD #2 (this task's own brief): FACe accepting the request with no usable
      // numeroRegistro is a FAILURE, never a silent success — a reference nobody can look up is not
      // a reference at all. Same hard-success contract every transport in this directory enforces.
      if (!numeroRegistro) {
        throw new BadRequestException(
          'FACe accepted the request but returned no registry number (numeroRegistro) — treating ' +
            'this as a failed deposit, never a silent success.',
        );
      }

      logger.info('FACe deposit accepted', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, numeroRegistro },
      });

      return {
        message:
          `Deposited to FACe — número de registro ${numeroRegistro}. Conformity status (tramitación: ` +
          'Registrada/Contabilizada/Pagada/Rechazada) is tracked by the post-deposit sweep — see ' +
          'conformity/pollers/face-status-poller.ts for the timeline.',
        reference: numeroRegistro,
        providerId: FACE_PROVIDER_ID,
        artifacts: [
          {
            role: deps.facturaeFormatProvider.id,
            mime: deps.facturaeFormatProvider.mime,
            bytes: buildResult.bytes,
          },
        ],
      };
    },
  };
}
