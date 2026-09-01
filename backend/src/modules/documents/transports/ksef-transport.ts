/**
 * The "ksef" transport — root TODO item 10 ("transports nationaux"), wave 2: Poland's Krajowy System
 * e-Faktur. Same `DocumentTransport` interface `pdp-transport.ts` implements, registered the same
 * way (`TransportRegistry.register` — see that file's own header on why nothing here treats KSeF
 * specially).
 *
 * The client (`ksef/ksef-client.ts`) and its crypto (`ksef/ksef-crypto.ts`) are REPRISED VERBATIM
 * from git tag `avant-refonte-documents` — a real CLEARED status + a real `ksefNumber` were obtained
 * end-to-end against `ksef-test.mf.gov.pl` there (2026-06-28). What is NEW in this file is the
 * ORCHESTRATION: the old engine's `ksef-transmission.ts` was a `TransmissionProvider` for a
 * lifecycle runtime that no longer exists (event-sourced signals, a `poll()` a scheduler called on a
 * timer) — this transport instead follows `pdp-transport.ts`'s OWN, narrower wave-1 contract: a
 * `send()` SUCCEEDS the moment KSeF ACCEPTS the online-session submission (a non-empty session +
 * invoice reference back from `POST /sessions/online/{ref}/invoices`), never waiting for the
 * asynchronous CLEARED verdict. Chasing that verdict needs a POLLER (the old engine's own, or a new
 * one) — consigned to TODO_ISSUES.md as this item's named remainder, the same way PDP's own
 * conformity-poll gap already is, NOT guessed at here.
 *
 * Two distinct failure shapes, both loud, neither silent — same split `pdp-transport.ts`'s own
 * header documents:
 *  - `preflight()` — no KSeF channel connected for this company (missing token/NIP) — thrown BEFORE
 *    anything is persisted or queued.
 *  - `send()` — connected, but the KSeF round-trip itself fails (auth rejected, network error, or
 *    KSeF answers with no usable session/invoice reference) — thrown from inside `deliver()`, so
 *    BullMQ's own retries run before `send_failed` is ever recorded.
 * An accepted submission with an EMPTY session or invoice reference is the SECOND kind of failure,
 * never a success — this task's own mutation #2 target: a reference nobody can look up is not a
 * reference at all (the exact same hard-success contract `pdp-transport.ts` already enforces for its
 * own deposit id).
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentFormatProvider } from '../formats/format-provider';
import { companyToFormatParty, clientToFormatParty } from '../formats/party-snapshot';
import prisma from '@/prisma/prisma.service';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';
import { FetchKsefHttpClient } from './ksef/fetch-http-client';
import { KsefClient, KsefEnvironment } from './ksef/ksef-client';
import { generateSessionKey } from './ksef/ksef-crypto';
import { loadVendorizedKeys } from './ksef/ksef-public-keys';

export interface KsefTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The FA(3) provider (`formats/national/fa3-provider.ts`) — the ONLY payload this transport ever
   *  sends, gated by the REAL vendored `schemat_FA3.xsd` before this file ever sees the bytes (see
   *  that provider's own header: an invalid FA(3) is never even built into a "valid" result). */
  fa3FormatProvider: DocumentFormatProvider;
}

const PROVIDER_ID = 'ksef';

/** Same "module-level constant, reached only through invoiceTransportId" choice `pdp-transport.ts`
 *  makes for the identical reason — see that file's own header. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/** Max attempts / interval polling the SHORT-LIVED auth handshake (challenge → token → status →
 *  redeem) — NOT the invoice's own conformity poll (out of scope, see this file's header). REPRISED
 *  verbatim from `ksef-transmission.ts` at the repère: the auth status usually flips within one or
 *  two polls in practice. */
const AUTH_POLL_ATTEMPTS = 5;
const AUTH_POLL_INTERVAL_MS = 2000;

export interface KsefCredentials {
  nip: string;
  ksefToken: string;
  environment: KsefEnvironment;
}

/** Extracts and validates the fields this transport needs — shared by `preflight()` and `send()`,
 *  same discipline `pdp-transport.ts#extractCredentials` holds. `environment` comes from the ROW
 *  itself (`ResolvedChannelConfig.environment`, TEST/PROD — already a first-class concept the whole
 *  channels module carries for every provider), never a second, redundant `config.environment`
 *  field: the settings screen's existing Environment selector already IS this. */
export function extractKsefCredentials(resolved: ResolvedChannelConfig): KsefCredentials | null {
  const { nip, ksefToken } = resolved.config;
  if (typeof nip !== 'string' || !nip || typeof ksefToken !== 'string' || !ksefToken) return null;
  return { nip, ksefToken, environment: resolved.environment === 'PROD' ? 'prod' : 'test' };
}

async function requireConnectedKsef(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<KsefCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, PROVIDER_ID);
  const credentials = resolved && extractKsefCredentials(resolved);
  if (!credentials) {
    logger.warn('KSeF transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The KSeF channel is not connected for this company. Connect it in company settings ' +
        '(Channels → KSeF) before sending an invoice through it — there is no default channel.',
    );
  }
  return credentials;
}

/** The short auth handshake (challenge → ksef-token → poll status → redeem) — REPRISED verbatim in
 *  SHAPE from `ksef-transmission.ts` at the repère, just no longer wrapped in a `TransmissionResult`.
 *  Throws on outright rejection or on exhausting the poll budget — both are genuine send() failures,
 *  never a silent partial state. Exported so `conformity/pollers/ksef-status-poller.ts` can reuse the
 *  EXACT same handshake rather than a second, drifting copy — a poll needs its own fresh access token
 *  just like `send()` does (KSeF access tokens are short-lived), and this is the one place that
 *  already gets it right. */
export async function authenticate(client: KsefClient): Promise<string> {
  const challenge = await client.authChallenge();
  const authResponse = await client.authKsefToken(challenge.challenge, challenge.timestampMs);

  for (let attempt = 0; attempt < AUTH_POLL_ATTEMPTS; attempt++) {
    const status = await client.authStatus(
      authResponse.referenceNumber,
      authResponse.authenticationToken.token,
    );
    if (status.status.code === 200) {
      const tokens = await client.authRedeem(authResponse.authenticationToken.token);
      return tokens.accessToken.token;
    }
    if (status.status.code >= 400) {
      throw new Error(
        `KSeF authentication rejected (code ${status.status.code}: ${status.status.description})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, AUTH_POLL_INTERVAL_MS));
  }
  throw new Error('KSeF authentication did not complete within the poll budget — still "processing".');
}

export function buildKsefTransport(deps: KsefTransportDeps): DocumentTransport {
  return {
    async preflight(companyId: string): Promise<void> {
      await requireConnectedKsef(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      // Re-resolved rather than trusting the preflight's own result — same reasoning
      // `pdp-transport.ts#send` already documents for its own re-resolution.
      const credentials = await requireConnectedKsef(deps.channelCredentials, ctx.companyId);

      const data = (ctx.document.data ?? {}) as Record<string, unknown>;
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
          `Cannot submit to KSeF: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      const buildResult = await deps.fa3FormatProvider.build(
        INVOICE_DESCRIPTOR,
        ctx.document,
        companyToFormatParty(company),
        clientToFormatParty(client),
      );
      if (!buildResult.validation.valid) {
        // Same gate `pdp-transport.ts` enforces for its own Factur-X build — an invalid FA(3)
        // (judged by the REAL vendored schemat_FA3.xsd, `fa3-provider.ts`'s own header) is never
        // submitted to KSeF either.
        throw new BadRequestException({
          message: 'Cannot submit to KSeF: the generated FA(3) document failed XSD validation.',
          errors: buildResult.validation.errors,
        });
      }
      const xmlContent = new TextDecoder('utf-8').decode(buildResult.bytes);

      const keys = loadVendorizedKeys(credentials.environment);
      const http = new FetchKsefHttpClient();
      const ksefClient = new KsefClient(http, {
        environment: credentials.environment,
        nip: credentials.nip,
        ksefToken: credentials.ksefToken,
        tokenEncryptionKeyPem: keys.tokenEncryptionKeyPem,
        symmetricKeyPem: keys.symmetricKeyPem,
      });

      let sessionRef = '';
      let invoiceRef = '';
      try {
        logger.info('KSeF: authenticating', { category: 'documents', details: { companyId: ctx.companyId } });
        const accessToken = await authenticate(ksefClient);

        logger.info('KSeF: opening online session', {
          category: 'documents',
          details: { companyId: ctx.companyId },
        });
        const sessionKey = generateSessionKey();
        const session = await ksefClient.openOnlineSession(accessToken, sessionKey);
        sessionRef = session.referenceNumber ?? '';

        logger.info('KSeF: sending invoice', {
          category: 'documents',
          details: { companyId: ctx.companyId },
        });
        const invoiceResult = await ksefClient.sendInvoice(sessionRef, accessToken, xmlContent, sessionKey);
        invoiceRef = invoiceResult.referenceNumber ?? '';

        // Close the session even though this wave never polls its outcome — an open session left
        // dangling is a real KSeF-side resource, not a free no-op to skip.
        await ksefClient.closeSession(sessionRef, accessToken);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('KSeF submission failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` — see async-send.ts's own header: BullMQ's retries
        // get a chance to run before this ever becomes "send_failed".
        throw new BadRequestException(`KSeF submission failed: ${message}`);
      }

      if (!sessionRef || !invoiceRef) {
        // THE HARD-SUCCESS CONTRACT (this task's own mutation #2 target): an accepted call with no
        // usable session/invoice reference is a FAILURE, never a silent success.
        throw new BadRequestException(
          'KSeF accepted the request but returned no usable session/invoice reference — treating ' +
            'this as a failed submission, never a silent success.',
        );
      }

      const reference = `${sessionRef}|${invoiceRef}`;
      logger.info('KSeF submission accepted', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, reference },
      });

      return {
        message:
          `Submitted to KSeF — session ${sessionRef}, invoice ${invoiceRef}. Clearance status (the ` +
          'ksefNumber) is tracked by the post-deposit sweep, gated behind KSeF credentials — see ' +
          'conformity/ for the timeline (and that module for the honesty note on how well-verified ' +
          'this particular mapping is).',
        reference,
        providerId: PROVIDER_ID,
        // Root TODO item 14 ("archivage légal") — the ONLY artifact this transport ever delivers is
        // the FA(3) actually submitted (`buildResult.bytes`, already gated valid above), same
        // reasoning as `pdp-transport.ts`'s own `artifacts`.
        artifacts: [
          { role: deps.fa3FormatProvider.id, mime: deps.fa3FormatProvider.mime, bytes: buildResult.bytes },
        ],
      };
    },
  };
}
