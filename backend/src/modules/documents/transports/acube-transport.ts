/**
 * The "acube" transport - A-Cube (`acubeapi.com`), an Italian platform registered by the DGFiP that
 * is also a Peppol access point. Same `DocumentTransport` interface `pdp-transport.ts`,
 * `ksef-transport.ts` and `sdi-transport.ts` implement, registered the same way
 * (`TransportRegistry.register` in `documents-core.module.ts`) - nothing anywhere special-cases it,
 * a company opts in through `Company.invoiceTransportId` like for any other channel.
 *
 * STATUS: ✅ **round-trip proven live against the sandbox on 2026-09-24** - a real FatturaPA built by
 * this repository's own `formats/national/fatturapa-provider.ts`, gated by the real vendored
 * `Schema_VFPR12.xsd`, deposited through `acube/acube-client.ts` and answered with a real uuid, then
 * read back from the platform. See `documentation/docs/developer-guide/live-testing.md` for the
 * captured response and `acube/acube.live.spec.ts` for the spec that produced it.
 *
 * ## Why FatturaPA, and why the same bytes twice
 *
 * A-Cube's Italian invoicing API accepts either its own JSON representation of an invoice or the
 * original FatturaPA XML (`Content-Type: application/xml`). This transport deposits the XML. Two
 * reasons, both about not having two truths: this repository already builds FatturaPA and already
 * judges it against the real Agenzia delle Entrate XSD before anything leaves, so a JSON payload
 * would be a SECOND representation of the same invoice, validated by nobody here; and the bytes this
 * transport ARCHIVES (`DocumentTransportResult.artifacts`) are then byte-identical to the bytes it
 * actually sent, which is the whole point of archiving what was delivered rather than what could be
 * re-rendered.
 *
 * ## The deposit succeeds at acceptance, not at the SdI verdict
 *
 * Exactly the narrower contract `pdp-transport.ts`'s own header defines: `send()` SUCCEEDS the moment
 * A-Cube ACCEPTS the deposit (a non-empty `uuid` back from `POST /invoices`, HTTP 202). The deposit
 * is asynchronous by A-Cube's own design - the SdI outcome lands later, as a change of the invoice's
 * marking - and following it needs a poller in `conformity/pollers/`, which is separate work from the
 * deposit itself and is NOT guessed at here. `acube/acube-client.ts#getInvoice` is the read side such
 * a poller would build on.
 *
 * ## Two distinct failure shapes, both loud, neither silent
 *
 *  - `preflight()` - no A-Cube channel connected for this company (or an incomplete config) - thrown
 *    BEFORE anything is persisted or queued (see `transport-registry.ts`'s own `preflight` header).
 *  - `send()` - connected, but the deposit itself fails (credentials refused, network error, or
 *    A-Cube answers with no usable uuid) - thrown from inside `deliver()`, so BullMQ's own retries
 *    get a chance to run before `send_failed` is ever recorded (`actions/async-send.ts`).
 *
 * An accepted deposit with an EMPTY uuid is treated as the SECOND kind of failure, never a success -
 * the hard-success contract every transport in this directory enforces: a reference nobody can look
 * up on the platform is not a reference at all.
 *
 * ## About the credential this channel stores
 *
 * A-Cube authenticates with the ACCOUNT's own e-mail and password (there is no per-integration API
 * key - see `acube/acube-client.ts#authenticate`), so the value a company stores here opens the web
 * console too. The settings copy below says so, and says to use a dedicated generated password: a
 * channel credential leaking is meant to cost a sandbox or an invoicing scope, never a whole account.
 *
 * ## Peppol, deliberately not built and deliberately not shut out
 *
 * The same A-Cube account is a Peppol access point, and the JWT this integration already obtains
 * carries the Peppol role (observed live - see `acube/acube-client.ts`'s header). Nothing Peppol is
 * implemented here, because Peppol needs a different payload (`formats/peppol-bis-provider.ts`)
 * and a participant-addressing decision this issue does not settle. What IS in place is the seam:
 * `AcubeJurisdiction` plus `JURISDICTION_HOSTS` in the client, so reaching that access point later is
 * a host-table row and a format choice, never a second authentication design.
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
import { AcubeClient, AcubeEnvironment } from './acube/acube-client';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

export interface AcubeTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The FatturaPA provider (`formats/national/fatturapa-provider.ts`) - the ONLY payload this
   *  transport ever deposits, gated by the REAL vendored `Schema_VFPR12.xsd` before this file ever
   *  sees the bytes. See this file's own header for why the XML, not A-Cube's JSON shape. */
  fatturapaFormatProvider: DocumentFormatProvider;
  /** Injectable ONLY for tests - a production caller omits it and gets a REAL `AcubeClient` built
   *  from this company's own connected credentials. The same DI seam `sdi-transport.ts` holds for
   *  its own `httpPort`, and for the same reason: the orchestration around the client deserves
   *  coverage that does not depend on a real network. */
  clientFactory?: (credentials: AcubeCredentials) => Pick<AcubeClient, 'sendInvoice' | 'getBaseUrl'>;
}

const PROVIDER_ID = 'acube';

/** Same "the invoice's OWN base descriptor, module-level constant" choice `pdp-transport.ts` makes
 *  for the identical reason: this transport is reached ONLY through `invoiceTransportId`, so it is
 *  always an invoice, never another document type, that it ever builds a payload for. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

export interface AcubeCredentials {
  email: string;
  password: string;
  /** Derived from the ROW itself (`ResolvedChannelConfig.environment`, TEST/PROD - already a
   *  first-class concept the whole channels module carries for every provider), never a second,
   *  redundant `config.environment` field: the settings screen's existing Environment selector
   *  already IS this. Same choice `ksef-transport.ts#extractKsefCredentials` documents. */
  environment: AcubeEnvironment;
}

/** Extracts and validates the fields this transport actually needs out of a resolved config -
 *  shared by `preflight()` and `send()` so neither can drift from what "complete enough to try"
 *  means. */
export function extractAcubeCredentials(resolved: ResolvedChannelConfig): AcubeCredentials | null {
  const { email, password } = resolved.config;
  if (typeof email !== 'string' || !email) return null;
  if (typeof password !== 'string' || !password) return null;
  return { email, password, environment: resolved.environment === 'PROD' ? 'production' : 'sandbox' };
}

async function requireConnectedAcube(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<AcubeCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, PROVIDER_ID);
  const credentials = resolved && extractAcubeCredentials(resolved);
  if (!credentials) {
    logger.warn('A-Cube transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The A-Cube channel is not connected for this company (an account e-mail and password are ' +
        'both required). Connect it in company settings (Channels → A-Cube) before sending an ' +
        'invoice through it - there is no default channel. A-Cube has no per-integration API key, ' +
        'so use a dedicated, generated password for this account and nothing else.',
    );
  }
  return credentials;
}

export function buildAcubeTransport(deps: AcubeTransportDeps): DocumentTransport {
  return {
    // Runs BEFORE anything is persisted or queued - checks ONLY that a usable connection exists; the
    // actual deposit is attempted in `send()` below, at delivery time.
    async preflight(companyId: string): Promise<void> {
      await requireConnectedAcube(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      // Re-resolved rather than trusting the preflight's own result - the company's configuration
      // could have changed in the (possibly long, retried) time between the two calls. Same
      // reasoning every other transport in this directory already documents.
      const credentials = await requireConnectedAcube(deps.channelCredentials, ctx.companyId);

      const data = (ctx.document.data ?? {}) as Record<string, unknown>;
      const clientId = typeof data.client === 'string' ? data.client : undefined;
      const [company, client] = await Promise.all([
        prisma.company.findUnique({ where: { id: ctx.companyId }, include: { partyIdentifiers: true } }),
        // Scoped by companyId - `clientId` comes straight off the document's own `data.client`, never
        // checked for existence at write time (descriptors/field-kinds.ts's own comment on the
        // 'reference' kind), so a bare `findUnique` would happily hand back another tenant's client.
        clientId
          ? prisma.client.findFirst({
              where: { id: clientId, companyId: ctx.companyId },
              include: { partyIdentifiers: true },
            })
          : Promise.resolve(null),
      ]);
      if (!company) {
        throw new BadRequestException(`Company "${ctx.companyId}" not found.`);
      }
      if (!client) {
        throw new BadRequestException(
          `Cannot deposit to A-Cube: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      const buildResult = await deps.fatturapaFormatProvider.build(
        INVOICE_DESCRIPTOR,
        ctx.document,
        companyToFormatParty(company),
        clientToFormatParty(client),
      );
      if (!buildResult.validation.valid) {
        // Same gate `documents.service.ts#downloadDocumentFormat` enforces for a manual download -
        // an invalid FatturaPA artifact is never deposited either, just like it is never served.
        throw new BadRequestException({
          message: 'Cannot deposit to A-Cube: the generated FatturaPA document failed XSD validation.',
          errors: buildResult.validation.errors,
        });
      }

      const xmlBytes = Buffer.from(buildResult.bytes);
      const acubeClient = deps.clientFactory
        ? deps.clientFactory(credentials)
        : new AcubeClient({
            email: credentials.email,
            password: credentials.password,
            environment: credentials.environment,
          });

      let uuid: string;
      try {
        logger.info('A-Cube: depositing FatturaPA', {
          category: 'documents',
          details: {
            companyId: ctx.companyId,
            documentId: ctx.document.id,
            baseUrl: acubeClient.getBaseUrl(),
          },
        });
        const deposited = await acubeClient.sendInvoice(xmlBytes);
        uuid = typeof deposited?.uuid === 'string' ? deposited.uuid : '';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('A-Cube deposit failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` - see async-send.ts's own header: BullMQ's retries
        // get a chance to run before this ever becomes "send_failed".
        throw new BadRequestException(`A-Cube deposit failed: ${message}`);
      }

      if (!uuid) {
        // THE HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): an accepted
        // deposit with no usable uuid is a FAILURE, never a silent success - a reference nobody can
        // look up on the platform is not a reference at all.
        throw new BadRequestException(
          'A-Cube accepted the request but returned no invoice uuid - treating this as a failed ' +
            'deposit, never a silent success.',
        );
      }

      logger.info('A-Cube deposit accepted', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, uuid },
      });

      return {
        message:
          `Deposited to A-Cube - invoice uuid ${uuid}. The SdI outcome is asynchronous and is NOT ` +
          'followed here: this channel registers no poller in conformity/ yet (see this ' +
          "transport's own header for that named remainder).",
        reference: uuid,
        providerId: PROVIDER_ID,
        // Legal archiving - the ONLY artifact this transport ever
        // delivers is the FatturaPA actually deposited (`xmlBytes`, already gated valid above):
        // never a second, separately-rendered document nobody actually sent anywhere through this
        // transport. `deps.fatturapaFormatProvider.id`/`.mime` (not a literal) so this can never
        // drift from what `format-registry.ts` itself calls this provider.
        artifacts: [
          {
            role: deps.fatturapaFormatProvider.id,
            mime: deps.fatturapaFormatProvider.mime,
            bytes: xmlBytes,
          },
        ],
      };
    },
  };
}
