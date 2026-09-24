/**
 * The "iopole" transport - Iopole (`iopole.com`), a French, DGFiP-registered transmission platform.
 *
 * Same `DocumentTransport` interface `pdp-transport.ts` / `chorus-pro-transport.ts` /
 * `ksef-transport.ts` implement, registered the same way (`TransportRegistry.register` in
 * `documents-core.module.ts`), opted into the same way (`Company.invoiceTransportId`). Nothing about
 * this platform is special-cased anywhere else - see `transport-registry.ts`'s own header: the
 * registry is open by design and never picks a transport on a company's behalf.
 *
 * The client (`iopole/iopole-client.ts`) speaks the wire protocol; this file resolves the company's
 * credentials, builds the payload and enforces the hard-success contract - the same split every
 * sibling transport in this directory holds.
 *
 * WHAT A DEPOSIT MEANS HERE, and what it deliberately does not. Iopole's API is ASYNCHRONOUS:
 * `POST /v1/invoice` answers `201 { type: "INVOICE", id: "<uuid>" }`, which means the file was
 * accepted for processing and can be followed by that id - NOT that it passed conformity. Following
 * the verdict (the platform's own SUBMITTED → ISSUED → RECEIVED lifecycle, or a REJECTED /
 * UNACCEPTABLE) needs a poller in `conformity/pollers/`, which is SEPARATE work and is deliberately
 * not attempted here: a poller that could only ever answer PENDING is exactly the false green this
 * repository has already been burned by once (see `pdp/pdp.live.spec.ts`'s own header for that
 * history). This transport's contract therefore stops, honestly, at "accepted, here is the id".
 * `providerId` below is still set for the record's own honesty - the sweep simply never selects it,
 * since eligibility is gated on the POLLER REGISTRY knowing the id (see
 * `DocumentTransportResult.providerId`'s own header, and "sdi", which holds the same position).
 *
 * THE PAYLOAD is Factur-X (`formats/facturx-provider.ts`), the same deliberate choice
 * `pdp-transport.ts` makes and for the same reason: the platform accepts UBL, CII and Factur-X
 * alike, and the format provider already gates the embedded CII through the REAL vendored EN 16931
 * Schematron, so an artifact that fails that gate is never deposited, only refused, named.
 *
 * CREDENTIALS - three fields, all three genuinely needed, and the third is the one that surprises:
 *  - `clientId` IS THE ACCOUNT'S E-MAIL ADDRESS. Not a typo to be cleaned up on its way through -
 *    see `iopole/iopole-client.ts`'s own header, point 1, for the live verification.
 *  - `clientSecret` - the OAuth2 client_credentials secret.
 *  - `customerId` - mandatory on EVERY API call, not just at authentication (header `customer-id`).
 *    It is NOT the sandbox scope that appears in the token's own `scope` claim, which looks
 *    confusingly similar; a company reads its own value from `GET /v1/config/customer/id`.
 * `environment` comes from the channel ROW itself (`ResolvedChannelConfig.environment`), never a
 * second config field - the same convention `chorus-pro-transport.ts` documents for itself.
 *
 * Two distinct failure shapes, both loud, neither silent - the same split every transport here
 * documents:
 *  - `preflight()` - no Iopole channel connected for this company (or an incomplete config) - thrown
 *    BEFORE anything is persisted or queued.
 *  - `send()` - connected, but the deposit itself fails (auth rejected, network error, an artifact
 *    that failed the EN 16931 gate, no client on file, or Iopole answering with no usable invoice
 *    id) - thrown from inside `deliver()`, so BullMQ's own retries get a chance to run before this
 *    ever becomes `send_failed` (see `actions/async-send.ts`'s own header).
 * An accepted deposit with an EMPTY id is the SECOND kind of failure, never a success - the
 * hard-success contract (documentation/docs/developer-guide/live-testing.md): a reference nobody can
 * look up is not a reference at all.
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
import { IopoleClient, IopoleClientConfig, iopoleFileExtensionFor } from './iopole/iopole-client';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

export interface IopoleTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The Factur-X provider (`formats/facturx-provider.ts`) - see this file's own header on why this
   *  format, and why the artifact is gated before it is ever deposited. */
  facturxFormatProvider: DocumentFormatProvider;
}

export const IOPOLE_PROVIDER_ID = 'iopole';

/** Same "the invoice's OWN base descriptor, module-level constant" choice every sibling transport
 *  makes for the identical reason - see `pdp-transport.ts`'s own header. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/**
 * Iopole's own hosts, fixed per environment - never a user-editable field, the same convention
 * `chorus-pro-transport.ts#CHORUS_PRO_URLS` and `ksef-transport.ts#BASE_URLS` already hold for the
 * identical reason (a platform's API and OAuth hosts are a platform fact, not something a company's
 * settings screen should let anyone silently repoint) and the reason `iopole-client.ts`'s own header
 * can state there is no SSRF primitive to close.
 *
 * Both pairs were read from the platform itself on 2026-09-24, never transcribed from prose:
 *  - the sandbox token endpoint answered a real `HTTP 200` for this project's own account;
 *  - both `tokenUrl`s are the `token_endpoint` each realm's own OIDC discovery document advertises
 *    (`/realms/iopole/.well-known/openid-configuration`, fetched live on both hosts).
 * One oddity, recorded so nobody "fixes" it later: the SANDBOX discovery document declares its
 * issuer as `auth.preprod.iopole.fr` while answering on `auth.ppd.iopole.fr`. The two are the same
 * realm behind two names; `auth.ppd.iopole.fr` is the one this project actually authenticated
 * against, so it is the one named here.
 */
export const IOPOLE_URLS = {
  sandbox: {
    apiBaseUrl: 'https://api.ppd.iopole.fr',
    tokenUrl: 'https://auth.ppd.iopole.fr/realms/iopole/protocol/openid-connect/token',
  },
  prod: {
    apiBaseUrl: 'https://api.iopole.com',
    tokenUrl: 'https://auth.iopole.com/realms/iopole/protocol/openid-connect/token',
  },
} as const;

export interface IopoleCredentials {
  clientId: string;
  clientSecret: string;
  customerId: string;
  environment: 'sandbox' | 'prod';
}

/** Extracts and validates the three fields this transport actually needs out of a resolved config -
 *  shared by `preflight()` and `send()` so neither can drift from what "complete enough to try"
 *  means, the same discipline every sibling transport's own `extractCredentials` holds. */
export function extractIopoleCredentials(resolved: ResolvedChannelConfig): IopoleCredentials | null {
  const { clientId, clientSecret, customerId } = resolved.config;
  if (typeof clientId !== 'string' || !clientId) return null;
  if (typeof clientSecret !== 'string' || !clientSecret) return null;
  // Refused here, with the other two, rather than deep inside the client: `customer-id` is mandatory
  // on every Iopole call (see `iopole-client.ts`'s own header, point 3), so a config without one is
  // incomplete in exactly the same sense a missing secret is.
  if (typeof customerId !== 'string' || !customerId) return null;
  return {
    clientId,
    clientSecret,
    customerId,
    environment: resolved.environment === 'PROD' ? 'prod' : 'sandbox',
  };
}

async function requireConnectedIopole(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<IopoleCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, IOPOLE_PROVIDER_ID);
  const credentials = resolved && extractIopoleCredentials(resolved);
  if (!credentials) {
    logger.warn('Iopole transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The Iopole channel is not connected for this company (a client id, a client secret AND a ' +
        'customer id are all required). Connect it in company settings (Channels → Iopole) before ' +
        'sending an invoice through it - there is no default channel.',
    );
  }
  return credentials;
}

/** Builds a REAL `IopoleClient` for this company's connected credentials - one instance per call,
 *  the same "no shared, cross-request state beyond the client's own short-lived token cache" choice
 *  every sibling transport's own client construction makes. */
export function buildIopoleClient(credentials: IopoleCredentials): IopoleClient {
  const config: IopoleClientConfig = {
    ...IOPOLE_URLS[credentials.environment],
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    customerId: credentials.customerId,
  };
  return new IopoleClient(config);
}

export function buildIopoleTransport(deps: IopoleTransportDeps): DocumentTransport {
  return {
    // Runs BEFORE anything is persisted or queued - checks ONLY that a usable connection exists; the
    // actual deposit is attempted in `send()` below, at delivery time.
    async preflight(companyId: string): Promise<void> {
      await requireConnectedIopole(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      // Re-resolved rather than trusting the preflight's own result - the same reasoning every
      // sibling transport's own `send()` documents: the company's configuration could have changed
      // in the (possibly long, retried) time between the two calls.
      const credentials = await requireConnectedIopole(deps.channelCredentials, ctx.companyId);

      const data = (ctx.document.data ?? {}) as Record<string, unknown>;
      const clientId = typeof data.client === 'string' ? data.client : undefined;
      const [company, client] = await Promise.all([
        prisma.company.findUnique({ where: { id: ctx.companyId }, include: { partyIdentifiers: true } }),
        // Scoped by companyId - `clientId` comes straight off the document's own `data.client`, never
        // checked for existence at write time (`descriptors/field-kinds.ts`'s own comment on the
        // 'reference' kind), so a bare `findUnique` would happily hand back another tenant's client.
        // A `null` result (foreign or nonexistent id) lands on the exact same "no valid client on
        // file" refusal just below that a genuinely absent client already produced.
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
          `Cannot deposit to Iopole: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      const buildResult = await deps.facturxFormatProvider.build(
        INVOICE_DESCRIPTOR,
        ctx.document,
        companyToFormatParty(company),
        clientToFormatParty(client),
        ctx.companyId,
      );
      if (!buildResult.validation.valid) {
        // The same gate `documents.service.ts#downloadDocumentFormat` enforces for a manual download
        // - an invalid EN 16931 artifact is never deposited either, just like it is never served.
        throw new BadRequestException({
          message: 'Cannot deposit to Iopole: the generated Factur-X document failed EN 16931 validation.',
          errors: buildResult.validation.errors,
        });
      }

      const iopoleClient = buildIopoleClient(credentials);
      // The platform checks the uploaded file's own NAME against `^.*.(pdf|PDF|xml|XML|Pdf|Xml)$` -
      // see `iopoleFileExtensionFor`'s own header. Derived from the format provider's declared mime,
      // never a literal, so this cannot drift from what is actually being uploaded.
      const extension = iopoleFileExtensionFor(deps.facturxFormatProvider.mime);
      const fileName = `${(ctx.document.displayNumber ?? ctx.document.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}`;

      let invoiceId: string;
      try {
        await iopoleClient.authenticate();
        const created = await iopoleClient.sendInvoice(buildResult.bytes, {
          mime: deps.facturxFormatProvider.mime,
          fileName,
        });
        invoiceId = created?.id != null ? String(created.id) : '';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Iopole deposit failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` - see `async-send.ts`'s own header: BullMQ's retries
        // get a chance to run before this ever becomes "send_failed".
        throw new BadRequestException(`Iopole deposit failed: ${message}`);
      }

      if (!invoiceId) {
        // THE HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): an accepted
        // upload with no usable invoice id is a FAILURE, never a silent success - a reference nobody
        // can look up on the platform is not a reference at all.
        throw new BadRequestException(
          'Iopole accepted the request but returned no invoice id - treating this as a failed ' +
            'deposit, never a silent success.',
        );
      }

      logger.info('Iopole deposit accepted', {
        category: 'documents',
        details: {
          companyId: ctx.companyId,
          documentId: ctx.document.id,
          environment: credentials.environment,
          invoiceId,
        },
      });

      return {
        message:
          `Deposited to Iopole - invoice id ${invoiceId}. The platform's own conformity verdict ` +
          '(SUBMITTED/ISSUED/RECEIVED, or a REJECTED/UNACCEPTABLE) arrives asynchronously and is NOT ' +
          "followed yet: no poller is registered for this channel - see this transport's own header.",
        reference: invoiceId,
        providerId: IOPOLE_PROVIDER_ID,
        // Legal archiving - the ONLY artifact this transport ever delivers is the Factur-X actually
        // deposited (`buildResult.bytes`, already gated valid above): never a second, separately
        // rendered "plain PDF" nobody actually sent anywhere through this transport.
        // `deps.facturxFormatProvider.id`/`.mime` (not a literal) so this can never drift from what
        // `format-registry.ts` itself calls this provider.
        artifacts: [
          {
            role: deps.facturxFormatProvider.id,
            mime: deps.facturxFormatProvider.mime,
            bytes: buildResult.bytes,
          },
        ],
      };
    },
  };
}
