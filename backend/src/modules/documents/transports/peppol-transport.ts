/**
 * The "peppol" transport — root TODO item 10 remainder / item 26 wave, the highest-leverage channel
 * left unwired at this task's own start: DE/BE/NL/the Nordics run B2B e-invoicing over the Peppol
 * network, and several EU B2G routes name it too (see `b2g-routing/data/de.json`'s own header for
 * the German federal portal case this file does NOT resolve — read, but not wired here, see that
 * file's own updated note for why). Same `DocumentTransport` interface `pdp-transport.ts`/
 * `ksef-transport.ts` implement, registered the same way (`TransportRegistry.register`).
 *
 * The GENERIC Access Point adapter (`peppol/peppol-client.ts`) is REPRISED and adapted from git tag
 * `avant-refonte-documents` (`compliance/providers/transmission/peppol/peppol-client.ts`) — see that
 * file's own header for exactly what was kept, adapted, and dropped. Its own live status is
 * "live-deferred" (needs a real connected AP vendor); the ACTUAL live attempt this task ran went
 * through a DIFFERENT adapter, peppol.sh (`peppol/peppol-sh-client.ts` + `peppol/peppol-sh-live.
 * spec.ts`, zero-secret sandbox self-signup) — see that file's own header and `LIVE_TESTING.md` for
 * the raw, honest result. This PRODUCTION transport uses ONLY the generic adapter: the settings
 * screen's own `PROVIDER_FIELDS.peppol` (AP URL, API key, participant id, environment) has no
 * `apProvider` selector the way the repère's own `ap-adapters.ts` did — a company connects ONE real
 * AP vendor's own REST endpoint, whatever it is, behind that same common-denominator shape.
 *
 * The payload is `peppol-bis` (`formats/peppol-bis-provider.ts`) — the ONLY format this transport
 * ever sends, gated by the REAL vendored base EN 16931 Schematron PLUS the Peppol BIS delta before
 * this file ever sees the bytes. An artifact that fails EITHER gate is NEVER transmitted — see that
 * provider's own header for its OWN known, documented limitation (PEPPOL-EN16931-R002: a French
 * seller's three mandatory C. com. mentions trip the "no more than one Note" rule against a
 * non-German buyer) — `peppol-transport.spec.ts`'s own test proves what sending REALLY does for that
 * exact seller: refused, named, never transmitted, never a partial/garbled artifact sent instead.
 *
 * The RECEIVER is the client's own Peppol endpoint — the EXISTING `PEPPOL_ENDPOINT` party identifier
 * mechanism (already collected on both `Company` and `Client` — `company.settings.tsx`/
 * `client-upsert.tsx`, already read by `formats/semantic/build-semantic-invoice.ts#explicitEndpointFor`
 * for the BT-34/BT-49 electronic address). This transport reads it directly (never through that
 * function's own best-effort VAT/email-guessed FALLBACK, which exists only so an EN 16931 artifact
 * still validates when nobody bothered to fill it in) — an actual Peppol network delivery needs a
 * REAL, registered participant id, and silently guessing one would risk routing a real invoice to the
 * wrong party, or to nobody. Absent → a NAMED refusal saying exactly where to fill it in, never a
 * network call with a guessed address.
 *
 * Two distinct failure shapes, both loud, neither silent — same split every transport in this
 * directory documents:
 *  - `preflight()` — no Peppol channel connected for this company (or an incomplete config) — thrown
 *    BEFORE anything is persisted or queued.
 *  - `send()` — connected, but the send itself fails (network/auth error, missing receiver endpoint,
 *    an artifact that failed the format gate, or the AP answering with no usable message id) —
 *    thrown from inside `deliver()`, so BullMQ's own retries get a chance to run before this ever
 *    becomes `send_failed`.
 * An accepted send with an EMPTY message id is the SECOND kind of failure, never a success — this
 * task's own mutation #1 target, the same hard-success contract every transport in this directory
 * already enforces (LIVE_TESTING.md: "a reference nobody can look up is not a reference at all").
 *
 * Post-send conformity: the generic AP port's own `getStatus()` is exactly the kind of pull endpoint
 * `conformity/authority-status-poller.ts` exists for — `conformity/pollers/peppol-status-poller.ts`
 * registers one, the same shape `pdp-status-poller.ts`/`ksef-status-poller.ts` already hold.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';
import { getIdentifier } from '@/utils/entity-identifiers';
import prisma from '@/prisma/prisma.service';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentFormatProvider } from '../formats/format-provider';
import { clientToFormatParty, companyToFormatParty } from '../formats/party-snapshot';
import { PEPPOL_BILLING_PROCESS_ID, PEPPOL_DOC_TYPES, PeppolApHttpClient } from './peppol/peppol-client';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

export interface PeppolTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The Peppol BIS Billing 3.0 provider (`formats/peppol-bis-provider.ts`) — the ONLY payload this
   *  transport ever sends, gated by the REAL vendored base EN 16931 Schematron PLUS the Peppol BIS
   *  delta (see that provider's own header). */
  peppolBisFormatProvider: DocumentFormatProvider;
}

export const PEPPOL_PROVIDER_ID = 'peppol';

/** Same "the invoice's OWN base descriptor, module-level constant" choice every sibling transport
 *  makes for the identical reason — see `pdp-transport.ts`'s own header. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

export interface PeppolCredentials {
  accessPointUrl: string;
  apiKey: string;
  /** The SELLER's own Peppol participant id under this connected AP account (e.g.
   *  '0009:12345678900011') — distinct from the RECEIVER's own endpoint, read per-invoice from the
   *  client's `PEPPOL_ENDPOINT` identifier below. */
  participantId: string;
  environment: 'TEST' | 'PROD';
}

/** Extracts and validates the three fields this transport actually needs — shared by `preflight()`
 *  and `send()`, same discipline every sibling transport's own `extractCredentials` holds. */
export function extractPeppolCredentials(resolved: ResolvedChannelConfig): PeppolCredentials | null {
  const { accessPointUrl, apiKey, participantId } = resolved.config;
  if (typeof accessPointUrl !== 'string' || !accessPointUrl) return null;
  if (typeof apiKey !== 'string' || !apiKey) return null;
  if (typeof participantId !== 'string' || !participantId) return null;
  return {
    accessPointUrl,
    apiKey,
    participantId,
    environment: resolved.environment === 'PROD' ? 'PROD' : 'TEST',
  };
}

async function requireConnectedPeppol(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<PeppolCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, PEPPOL_PROVIDER_ID);
  const credentials = resolved && extractPeppolCredentials(resolved);
  if (!credentials) {
    logger.warn('Peppol transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The Peppol channel is not connected for this company. Connect it in company settings ' +
        '(Channels → Peppol) before sending an invoice through it — there is no default channel.',
    );
  }
  return credentials;
}

export function buildPeppolTransport(deps: PeppolTransportDeps): DocumentTransport {
  return {
    async preflight(companyId: string): Promise<void> {
      await requireConnectedPeppol(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      // Re-resolved rather than trusting the preflight's own result — same reasoning every sibling
      // transport's own `send()` already documents.
      const credentials = await requireConnectedPeppol(deps.channelCredentials, ctx.companyId);

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
          `Cannot send via Peppol: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      // THE RECEIVER GATE — see this file's own header on why this is read directly (never through
      // `build-semantic-invoice.ts`'s own best-effort fallback): a real Peppol send needs a REAL,
      // registered participant id, never a guessed one.
      const receiverParticipantId = getIdentifier(client, 'PEPPOL_ENDPOINT');
      if (!receiverParticipantId) {
        throw new BadRequestException(
          'Cannot send via Peppol: this client has no Peppol endpoint on file. Set one on the ' +
            'client\'s own edit screen (Clients → this client → "Peppol / electronic routing") before ' +
            'sending — there is no default, and guessing a routing address risks delivering to the ' +
            'wrong participant, or to nobody.',
        );
      }

      const buildResult = await deps.peppolBisFormatProvider.build(
        INVOICE_DESCRIPTOR,
        ctx.document,
        companyToFormatParty(company),
        clientToFormatParty(client),
      );
      if (!buildResult.validation.valid) {
        // Same gate `pdp-transport.ts`/`ksef-transport.ts` enforce for their own builds — an artifact
        // that fails the base EN 16931 Schematron OR the Peppol BIS delta (`peppol-bis-provider.ts`'s
        // own R002 limitation for a French seller against a non-German buyer, among others) is NEVER
        // transmitted, only refused, named.
        throw new BadRequestException({
          message: 'Cannot send via Peppol: the generated Peppol BIS Billing 3.0 document failed validation.',
          errors: buildResult.validation.errors,
        });
      }

      const apClient = new PeppolApHttpClient({
        accessPointUrl: credentials.accessPointUrl,
        apiKey: credentials.apiKey,
        environment: credentials.environment,
      });

      let messageId: string;
      try {
        const result = await apClient.send({
          senderParticipantId: credentials.participantId,
          receiverParticipantId,
          documentTypeId: PEPPOL_DOC_TYPES.INVOICE_UBL,
          processId: PEPPOL_BILLING_PROCESS_ID,
          documentBytes: buildResult.bytes,
          idempotencyKey: ctx.document.displayNumber ?? ctx.document.id,
        });
        messageId = result.messageId ?? '';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Peppol send failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` — see async-send.ts's own header: BullMQ's retries get
        // a chance to run before this ever becomes "send_failed".
        throw new BadRequestException(`Peppol send failed: ${message}`);
      }

      if (!messageId) {
        // THE HARD-SUCCESS CONTRACT (LIVE_TESTING.md, and this task's own mutation #1): an AP that
        // answers OK with no usable message id is a FAILURE, never a silent success.
        throw new BadRequestException(
          'Peppol accepted the request but returned no message id — treating this as a failed send, ' +
            'never a silent success.',
        );
      }

      logger.info('Peppol send accepted', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, messageId },
      });

      return {
        message:
          `Sent via Peppol — access point message id ${messageId}. Delivery status is tracked by the ` +
          'post-send conformity sweep — see conformity/pollers/peppol-status-poller.ts.',
        reference: messageId,
        providerId: PEPPOL_PROVIDER_ID,
        // Root TODO item 14 ("archivage légal") — the ONLY artifact this transport ever delivers is
        // the Peppol BIS document actually sent (already gated valid above), same reasoning as every
        // sibling transport's own `artifacts`.
        artifacts: [
          {
            role: deps.peppolBisFormatProvider.id,
            mime: deps.peppolBisFormatProvider.mime,
            bytes: buildResult.bytes,
          },
        ],
      };
    },
  };
}
