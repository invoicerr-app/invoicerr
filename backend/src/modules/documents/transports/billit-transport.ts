/**
 * The "billit" transport - Billit (`billit.be`), a Belgian Peppol access point that is also
 * registered by the DGFiP as a French "plateforme agreee". Same `DocumentTransport` interface
 * `pdp-transport.ts` implements, registered the same way (`TransportRegistry.register` - see that
 * file's own header on why nothing here treats a platform specially, and why a company opts in
 * through `Company.invoiceTransportId` alone).
 *
 * ## What it deposits, and why that artifact
 *
 * Billit's `POST /peppol/sendxml` takes a Peppol BIS Billing 3.0 UBL document and puts it on the
 * Peppol network under the sending company's own identity. This transport therefore builds the
 * artifact with `formats/peppol-bis-provider.ts` - the provider that already runs BOTH the base
 * EN 16931 UBL Schematron AND the vendored Peppol BIS delta, both blocking - and deposits exactly
 * those bytes, which are also exactly the bytes it hands back for legal archiving. One artifact,
 * built once, validated once, sent once, archived once.
 *
 * The alternative route (`POST /orders`, Billit's own JSON invoice model, with Billit deriving the
 * UBL and recomputing the totals itself) is deliberately NOT used: it would make the document that
 * leaves the platform a document this codebase never built and can never archive, and it would give
 * the wire format two sources of truth that are free to drift. See `billit/billit-client.ts`'s own
 * header for the endpoint-level side of the same decision.
 *
 * ## Two distinct failure shapes, both loud, neither silent
 *
 * The same split `pdp-transport.ts`'s own header documents:
 *  - `preflight()` - no Billit channel connected for this company, or a configuration missing any of
 *    the three fields - thrown BEFORE anything is persisted or queued.
 *  - `send()` - connected, but the deposit itself fails (network error, Billit refusing the document
 *    on its own Peppol validation, or Billit answering with no usable InboxItemID) - thrown from
 *    inside `deliver()`, so BullMQ's own retries get a chance to run before `send_failed` is ever
 *    recorded (see `actions/async-send.ts`'s own header).
 * An accepted deposit with an EMPTY InboxItemID is treated as the SECOND kind of failure, never a
 * success - the hard-success contract (documentation/docs/developer-guide/live-testing.md): a
 * reference nobody can look up is not a reference at all.
 *
 * ## What this transport deliberately does NOT do
 *
 * NO POLLER. A deposit SUCCEEDS the moment Billit accepts the document and hands back an
 * InboxItemID. Billit exposes the delivery outcome afterwards (`GET /orders/{id}`'s own message log,
 * the Peppol IMR/MLR responses, and webhooks), and following that verdict is a `conformity/pollers/`
 * job - separate work, the same named remainder "pdp" and "ksef" already carry, not guessed at here.
 *
 * NO FRENCH "plateforme agreee" FLOW. Billit's PA routing is a different set of endpoints with its
 * own annuaire registration and its own status vocabulary; this transport speaks Peppol only. France
 * already has its own transports ("pdp", "chorus-pro").
 *
 * ## Known limit on the path to production, as of 2026-09-24
 *
 * The API key this transport authenticates with is, in Billit's own words, "only allowed for
 * non-commercial integrations" (https://docs.billit.be/docs/partyid-and-key). A commercial
 * production integration needs OAuth credentials requested from Billit support plus an approval step
 * (https://docs.billit.be/docs/authentication). Nothing in this file assumes otherwise: the
 * credentials are ordinary channel configuration, and swapping the header pair for an OAuth bearer
 * token later is a change confined to `billit/billit-client.ts`.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';
import prisma from '@/prisma/prisma.service';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentFormatProvider } from '../formats/format-provider';
import { clientToFormatParty, companyToFormatParty } from '../formats/party-snapshot';
import { BillitClient, BillitCredentials } from './billit/billit-client';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

export interface BillitTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The Peppol BIS Billing 3.0 provider (`formats/peppol-bis-provider.ts`) - the ONLY payload this
   *  transport ever deposits, gated by the REAL base EN 16931 UBL Schematron AND the REAL vendored
   *  Peppol delta before this file ever sees the bytes. */
  peppolBisFormatProvider: DocumentFormatProvider;
}

const PROVIDER_ID = 'billit';

/** Same "the invoice's OWN base descriptor, module-level constant" choice `pdp-transport.ts` makes
 *  for the identical reason - this transport is reached ONLY through `invoiceTransportId`, so it is
 *  always an invoice, never another document type, that it ever builds a payload for. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/** Extracts and validates the three fields this transport actually needs out of a resolved config -
 *  shared by `preflight()` and `send()` so neither can drift from what "complete enough to try"
 *  means, the same discipline `extractPdpCredentials` holds. `partyId` is NOT optional and has no
 *  default: Billit's PartyID differs between sandbox and production, and an account covering several
 *  companies has one per company while the key stays the same, so guessing one would silently file
 *  an invoice under the wrong company. */
export function extractBillitCredentials(resolved: ResolvedChannelConfig): BillitCredentials | null {
  const { baseUrl, apiKey, partyId } = resolved.config;
  if (typeof baseUrl !== 'string' || !baseUrl) return null;
  if (typeof apiKey !== 'string' || !apiKey) return null;
  if (typeof partyId !== 'string' || !partyId) return null;
  return { baseUrl, apiKey, partyId };
}

async function requireConnectedBillit(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<BillitCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, PROVIDER_ID);
  const credentials = resolved && extractBillitCredentials(resolved);
  if (!credentials) {
    logger.warn('Billit transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The Billit channel is not connected for this company. Connect it in company settings ' +
        '(Channels → Billit) before sending an invoice through it - there is no default channel.',
    );
  }
  return credentials;
}

export function buildBillitTransport(deps: BillitTransportDeps): DocumentTransport {
  return {
    // Runs BEFORE anything is persisted or queued (see this file's own header) - checks ONLY that a
    // usable connection exists; the actual deposit is attempted in `send()` below, at delivery time.
    async preflight(companyId: string): Promise<void> {
      await requireConnectedBillit(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      // Re-resolved rather than trusting the preflight's own result - the company's configuration
      // could have changed in the (possibly long, retried) time between the two calls, the same
      // reasoning `pdp-transport.ts` already documents for its own re-resolution.
      const credentials = await requireConnectedBillit(deps.channelCredentials, ctx.companyId);

      const data = (ctx.document.data ?? {}) as Record<string, unknown>;
      const clientId = typeof data.client === 'string' ? data.client : undefined;
      const [company, client] = await Promise.all([
        prisma.company.findUnique({ where: { id: ctx.companyId }, include: { partyIdentifiers: true } }),
        // Scoped by companyId for the reason `pdp-transport.ts`'s own identical query documents:
        // `clientId` comes straight off the document's own `data.client` and is never checked for
        // existence at write time, so a bare `findUnique` would happily hand back another tenant's
        // client. A `null` result lands on the same "no valid client on file" refusal below that a
        // genuinely absent client already produces.
        clientId
          ? prisma.client.findFirst({
              where: { id: clientId, companyId: ctx.companyId },
              include: { partyIdentifiers: true, contacts: true },
            })
          : Promise.resolve(null),
      ]);
      if (!company) {
        throw new BadRequestException(`Company "${ctx.companyId}" not found.`);
      }
      if (!client) {
        throw new BadRequestException(
          `Cannot deposit to Billit: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      const buildResult = await deps.peppolBisFormatProvider.build(
        INVOICE_DESCRIPTOR,
        ctx.document,
        companyToFormatParty(company),
        clientToFormatParty(client),
        ctx.companyId,
      );
      if (!buildResult.validation.valid) {
        // Same gate `documents.service.ts#downloadDocumentFormat` enforces for a manual download -
        // an invalid EN 16931 / Peppol BIS artifact is never deposited either, just like it is never
        // served. Billit runs its own copy of the Peppol rules and would refuse it anyway; failing
        // here means the seller reads OUR rule citations rather than a foreign platform's.
        throw new BadRequestException({
          message: 'Cannot deposit to Billit: the generated Peppol BIS document failed validation.',
          errors: buildResult.validation.errors,
        });
      }

      const billitClient = new BillitClient(credentials);
      const xml = Buffer.from(buildResult.bytes).toString('utf8');

      let inboxItemId: string;
      try {
        const result = await billitClient.sendPeppolXml(xml);
        inboxItemId = result.inboxItemId;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Billit deposit failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` - see async-send.ts's own header: BullMQ's retries
        // get a chance to run before this ever becomes "send_failed".
        throw new BadRequestException(`Billit deposit failed: ${message}`);
      }

      if (!inboxItemId) {
        // THE HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): an accepted
        // upload with no usable identifier is a FAILURE, never a silent success.
        throw new BadRequestException(
          'Billit accepted the request but returned no InboxItemID - treating this as a failed ' +
            'deposit, never a silent success.',
        );
      }

      logger.info('Billit deposit accepted', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, inboxItemId },
      });

      return {
        message:
          `Deposited to Billit for Peppol delivery - InboxItemID ${inboxItemId}. Delivery to the ` +
          'receiver and any invoice response (IMR/MLR) are reported by Billit afterwards; no poller ' +
          'follows them yet (see this transport for that named remainder).',
        reference: inboxItemId,
        providerId: PROVIDER_ID,
        // Legal archiving - the ONLY artifact this transport ever delivers is the Peppol BIS UBL
        // actually deposited (`buildResult.bytes`, already gated valid above): never a second,
        // separately-rendered document nobody actually sent through this transport. The provider's
        // own `id`/`mime` (not a literal) so this can never drift from what `format-registry.ts`
        // itself calls this provider.
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
