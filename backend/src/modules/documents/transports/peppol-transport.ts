/**
 * The "peppol" transport — root TODO item 10 remainder / item 26 wave, the highest-leverage channel
 * left unwired at this task's own start: DE/BE/NL/the Nordics run B2B e-invoicing over the Peppol
 * network, and several EU B2G routes name it too (see `b2g-routing/data/de.json`'s own header for
 * the German federal portal case — "le trou allemand du B2G", now CLOSED via the format override
 * this file's own header, "THE FORMAT OVERRIDE", documents below; see that JSON file's own ADDENDUM
 * for the full, sourced resolution). Same `DocumentTransport` interface `pdp-transport.ts`/
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
 * The payload is `peppol-bis` (`formats/peppol-bis-provider.ts`) BY DEFAULT — gated by the REAL
 * vendored base EN 16931 Schematron PLUS the Peppol BIS delta before this file ever sees the bytes. An
 * artifact that fails EITHER gate is NEVER transmitted — see that provider's own header for its OWN
 * known, documented limitation (PEPPOL-EN16931-R002: a French seller's three mandatory C. com.
 * mentions trip the "no more than one Note" rule against a non-German buyer) — `peppol-transport.spec.
 * ts`'s own test proves what sending REALLY does for that exact seller: refused, named, never
 * transmitted, never a partial/garbled artifact sent instead.
 *
 * ## THE FORMAT OVERRIDE — root TODO item 10/26's own remainder, "le trou allemand du B2G"
 *
 * The Peppol NETWORK is content-agnostic — it is the same four-corner transport whether the envelope
 * carries a generic Peppol BIS invoice or a national CIUS built on the same UBL syntax. Germany's own
 * federal e-invoicing portal exploits exactly that: `b2g-routing/data/de.json`'s own addendum reads
 * (verbatim, e-rechnung-bund.de/faq/) that the merged ZRE/OZG-RE platform accepts Peppol as an INPUT
 * CHANNEL, while § 4 Abs. 1 ERechV — read at gesetze-im-internet.de, same file — still mandates
 * XRechnung as the invoice's own CONTENT regardless of which channel carried it. Sending generic
 * Peppol BIS over the (now accepted) Peppol channel would satisfy the CHANNEL half of that law while
 * silently failing the CONTENT half — exactly the "artefact qui A L'AIR conforme sans l'être" this
 * codebase refuses everywhere else (`format-registry.ts`, `structural-check.ts`).
 *
 * `DocumentTransportContext.formatOverride` (`transport-registry.ts`'s own header) is the fix: a B2G
 * rule that selects this transport (`actions/invoice-actions.ts#resolveB2gInvoiceTransport`) also
 * carries its OWN `formatSyntax` — forwarded verbatim as `ctx.formatOverride`. `resolveFormatForSend`
 * below is the ONLY place that reads it: absent (every ordinary B2B send, and every B2G rule that
 * routes to peppol with NO override recorded, which is every rule except DE today) means the ORIGINAL,
 * unchanged behavior — `peppolBisFormatProvider`, exactly as before this task, proven unchanged by
 * every pre-existing test in `peppol-transport.spec.ts`. Present but UNKNOWN to `deps.formatOverrides`
 * is a NAMED refusal, never a silent fall-back to Peppol BIS — the whole point of this mechanism is
 * that a government recipient gets EXACTLY the format the law names, or an honest block, never a
 * best-effort substitute. `documents-core.module.ts#buildTransportRegistry` wires the ONE override
 * shipped today: `{ xrechnung: { provider: xrechnungFormatProvider, documentTypeId: PEPPOL_DOC_TYPES.
 * INVOICE_XRECHNUNG_UBL } }`.
 *
 * Every OTHER transport in this directory has a FIXED format (pdp/chorus-pro → Factur-X, ksef → FA(3),
 * sdi → FatturaPA, face → Facturae signed, anaf → UBL, email → a rendered PDF) and simply never reads
 * `ctx.formatOverride` at all — setting it on their context (which `resolveB2gInvoiceTransport` does
 * unconditionally whenever a B2G rule applies, regardless of which transport it names) is harmless,
 * inert, and asserted so by this task's own tests: a fixed-format transport's own behavior is
 * UNCHANGED by a field it never looks at.
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

/**
 * One format this transport can build INSTEAD OF Peppol BIS, when `ctx.formatOverride` names it — see
 * this file's own header, "THE FORMAT OVERRIDE". `documentTypeId` is co-located with `provider` (never
 * a second, separately-keyed map) so the two can never drift apart: the URN announced to the Access
 * Point and the format actually built are, by construction, one fact, not two synchronized ones.
 */
export interface PeppolFormatOverride {
  provider: DocumentFormatProvider;
  documentTypeId: string;
}

export interface PeppolTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The Peppol BIS Billing 3.0 provider (`formats/peppol-bis-provider.ts`) — the DEFAULT payload this
   *  transport sends whenever `ctx.formatOverride` is absent (still the ONLY payload for every B2B
   *  send, and for a B2G rule that names peppol with no override), gated by the REAL vendored base EN
   *  16931 Schematron PLUS the Peppol BIS delta (see that provider's own header). */
  peppolBisFormatProvider: DocumentFormatProvider;
  /**
   * OPTIONAL — format providers this transport is able to build when `ctx.formatOverride` names one,
   * keyed by the SAME `formats/format-registry.ts` id. Absent, or a requested override with no entry
   * here, is a NAMED refusal in `send()` (`resolveFormatForSend`) — never a silent fall-back to Peppol
   * BIS. `documents-core.module.ts#buildTransportRegistry` wires the ONE entry shipped today:
   * `xrechnung` (Germany's ERechV, `b2g-routing/data/de.json`).
   */
  formatOverrides?: Record<string, PeppolFormatOverride>;
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

/**
 * Picks WHICH format this send actually builds — see this file's own header, "THE FORMAT OVERRIDE".
 * No override requested → the unchanged default, `peppolBisFormatProvider` under `PEPPOL_DOC_TYPES.
 * INVOICE_UBL` (every pre-existing test, and every B2B send, takes this branch, unmodified). An
 * override requested but not wired here → a NAMED refusal, never a silent fall-back to the default:
 * the whole reason a B2G rule names a format at all is that the wrong one is not an acceptable
 * substitute, only an honest block is.
 */
function resolveFormatForSend(
  deps: PeppolTransportDeps,
  formatOverride: string | undefined,
): { provider: DocumentFormatProvider; documentTypeId: string } {
  if (!formatOverride) {
    return { provider: deps.peppolBisFormatProvider, documentTypeId: PEPPOL_DOC_TYPES.INVOICE_UBL };
  }
  const override = deps.formatOverrides?.[formatOverride];
  if (!override) {
    throw new BadRequestException(
      `Cannot send via Peppol: this invoice's own routing rule requires the "${formatOverride}" ` +
        'format, but this deployment has no Peppol format override wired for it — a named gap, never ' +
        'a silent fall back to the default Peppol BIS Billing 3.0 payload.',
    );
  }
  return override;
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

      // THE FORMAT OVERRIDE — see this file's own header. `formatProvider`/`documentTypeId` replace
      // every direct `deps.peppolBisFormatProvider`/`PEPPOL_DOC_TYPES.INVOICE_UBL` reference below.
      const { provider: formatProvider, documentTypeId } = resolveFormatForSend(deps, ctx.formatOverride);

      const buildResult = await formatProvider.build(
        INVOICE_DESCRIPTOR,
        ctx.document,
        companyToFormatParty(company),
        clientToFormatParty(client),
      );
      if (!buildResult.validation.valid) {
        // Same gate `pdp-transport.ts`/`ksef-transport.ts` enforce for their own builds — an artifact
        // that fails the base EN 16931 Schematron OR its own delta (`peppol-bis-provider.ts`'s own
        // R002 limitation for a French seller against a non-German buyer; `xrechnung-provider.ts`'s
        // own BR-DE-1 for a seller with no IBAN on file, among others) is NEVER transmitted, only
        // refused, named — regardless of which format this particular send actually built.
        throw new BadRequestException({
          message: `Cannot send via Peppol: the generated ${formatProvider.syntax} document failed validation.`,
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
          documentTypeId,
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
        // the document ACTUALLY sent (Peppol BIS by default, or the format override — already gated
        // valid above), same reasoning as every sibling transport's own `artifacts`.
        artifacts: [
          {
            role: formatProvider.id,
            mime: formatProvider.mime,
            bytes: buildResult.bytes,
          },
        ],
      };
    },
  };
}
