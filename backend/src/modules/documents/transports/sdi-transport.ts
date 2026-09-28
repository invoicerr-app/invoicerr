/**
 * The "sdi" transport — Italy's Sistema di
 * Interscambio. Same `DocumentTransport` interface `pdp-transport.ts`/`ksef-transport.ts` implement,
 * registered the same way.
 *
 * STATUS: **implemented-awaiting-accreditation** (explicit user decision —
 * see `sdi/sdicoop-client.ts`'s own header for the full "what was read vs extrapolated" account). SdI
 * access for a real Sistema di Interscambio submission requires AdE (Agenzia delle Entrate)
 * intermediary accreditation and a qualified PFX certificate, NEITHER obtained (see
 * `documentation/docs/developer-guide/credentials-guide.md` §4) — so a REAL SOAP client now exists (`sdi/sdicoop-client.ts`,
 * `SdiCoopClient`, built from the published SdICoop WSDL/XSD/instructions, read and cited), but it has
 * NEVER been run against the true AdE endpoint: this transport is, by construction, unproven live
 * until accreditation lands. Previously `send()` reached
 * `sdi/sdi-client.ts`'s `UNACCREDITED_SDI_HTTP_PORT` unconditionally (every call failed with the SAME
 * "not implemented" message, whether or not credentials were configured); now, a company that HAS
 * connected all four fields (idTrasmittente/certificate/certificatePassword/`endpoint` — the
 * SdIRiceviFile URL AdE's own accreditation process assigns, never hardcoded, see
 * `sdicoop-client.ts`'s own header) gets a REAL attempt via `SdiCoopClient`; a company that has not
 * (today: everyone, since accreditation itself is the blocker) gets the SAME honest
 * `NotImplementedException` at `preflight()`, now pointing at `documentation/docs/developer-guide/credentials-guide.md` §4.
 * `SdiTransportDeps.httpPort` remains the seam a jest spec injects a mock into (see that spec's own
 * header), the same DI shape `facturx-provider.ts`'s factory already holds for an unrelated reason.
 *
 * Two distinct failure shapes, both loud, neither silent — same split every transport in this
 * directory documents:
 *  - `preflight()` — no SdI channel connected for this company (missing any of the four required
 *    fields) — thrown BEFORE anything is persisted or queued.
 *  - `send()` — connected, but the submission itself fails (today: ALWAYS in practice, since no real
 *    endpoint has ever been accredited to test against — but via a REAL SOAP attempt now, not a stub)
 *    — thrown from inside `deliver()`, so BullMQ's own retries run before `send_failed` is ever
 *    recorded.
 * An accepted submission with an EMPTY `idSdI` is the second kind of failure, never a success — the
 * same hard-success contract every transport in this directory enforces (enforced twice over: once
 * inside `sdicoop-client.ts#parseRiceviFileResponse` itself, once more here).
 *
 * The PUSH-side notifiche (RC/NS/MC/NE/DT/AT) are handled entirely separately —
 * `sdi/sdi-notifiche.controller.ts` (a `@Public()` HTTP endpoint SdI itself calls), never by this
 * transport or by a poller (`conformity/authority-status-poller.ts`'s own header: "sdi" registers
 * none, deliberately).
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
import {
  CredentialFieldDescriptor,
  DocumentTransport,
  DocumentTransportContext,
  DocumentTransportResult,
  formatBuildInputOf,
} from './transport-registry';

/** Issue #526 - exactly the four fields `extractSdiCredentials` below reads, replacing the
 *  frontend's own hard-coded `sdi` entry in `PROVIDER_FIELDS` (`channels.settings.tsx`).
 * `certificatePassword` is the one field marked NOT required here - matching the parser exactly: a
 *  real PFX legitimately can carry an empty one (see `SdiCredentials.certificatePassword`'s own
 * header). The frontend's OLD hard-coded copy did not mark it optional - a drift this catalogue now
 *  makes visible and fixes at the source. */
export const SDI_CREDENTIAL_FIELDS: CredentialFieldDescriptor[] = [
  {
    key: 'idTrasmittente',
    kind: 'text',
    valueType: 'string',
    required: true,
    placeholder: 'IT01234567890',
    labelKey: 'settings.channels.fields.sdiIdTrasmittente',
  },
  {
    key: 'endpoint',
    kind: 'text',
    valueType: 'string',
    required: true,
    placeholder: 'https://sdi.example.it/ricevi_file',
    labelKey: 'settings.channels.fields.sdiEndpoint',
  },
  {
    key: 'certificate',
    kind: 'secret',
    valueType: 'string',
    required: true,
    labelKey: 'settings.channels.fields.sdiCertificate',
  },
  {
    key: 'certificatePassword',
    kind: 'secret',
    valueType: 'string',
    required: false,
    labelKey: 'settings.channels.fields.sdiCertificatePassword',
  },
];
import { SdiClient, SdiHttpPort } from './sdi/sdi-client';
import { SdiCoopClient } from './sdi/sdicoop-client';

export interface SdiTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The FatturaPA provider (`formats/national/fatturapa-provider.ts`) — the ONLY payload this
   *  transport ever submits, gated by the REAL vendored `Schema_VFPR12.xsd`. */
  fatturapaFormatProvider: DocumentFormatProvider;
  /** Injectable ONLY for tests (see this file's own header) — a production caller omits this and
   *  gets a REAL `SdiCoopClient`, built from this company's own connected credentials. */
  httpPort?: SdiHttpPort;
}

const PROVIDER_ID = 'sdi';

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

interface SdiCredentials {
  idTrasmittente: string;
  certificate: string;
  certificatePassword?: string;
  /** The `SdIRiceviFile` HTTPS endpoint assigned to this trasmittente at AdE accreditation — see
   *  `sdicoop-client.ts`'s own header on why this is never a hardcoded constant the way KSeF's own
   *  base URLs are. Required to be "connected" (unlike `certificatePassword`, still optional below —
   *  a real PFX legitimately can carry an empty one): without it there is nowhere to even ATTEMPT a
   *  real submission. */
  endpoint: string;
}

/** Extracts and validates the fields this transport needs — shared by `preflight()` and `send()`.
 *  `idTrasmittente`/`certificate`/`endpoint` gate "connected"; a certificate password is common but
 *  not universal (some PFX files carry none), so it is read through when present without being
 *  required here — unchanged reasoning from before `endpoint` was added. */
export function extractSdiCredentials(resolved: ResolvedChannelConfig): SdiCredentials | null {
  const { idTrasmittente, certificate, certificatePassword, endpoint } = resolved.config;
  if (typeof idTrasmittente !== 'string' || !idTrasmittente) return null;
  if (typeof certificate !== 'string' || !certificate) return null;
  if (typeof endpoint !== 'string' || !endpoint) return null;
  return {
    idTrasmittente,
    certificate,
    certificatePassword: typeof certificatePassword === 'string' ? certificatePassword : undefined,
    endpoint,
  };
}

async function requireConnectedSdi(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<SdiCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, PROVIDER_ID);
  const credentials = resolved && extractSdiCredentials(resolved);
  if (!credentials) {
    logger.warn('SdI transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The SdI channel is not connected for this company (idTrasmittente/certificate/endpoint are ' +
        'all required). Connect it in company settings (Channels → SdI) before sending an invoice ' +
        'through it — there is no default channel. Connecting it for real requires AdE (Agenzia ' +
        'delle Entrate) intermediary accreditation first: see documentation/docs/developer-guide/credentials-guide.md §4 for the ' +
        'full procedure (SDICoop channel type, client/server CSRs, collaudo interoperability tests).',
    );
  }
  return credentials;
}

export function buildSdiTransport(deps: SdiTransportDeps): DocumentTransport {
  return {
    async preflight(companyId: string): Promise<void> {
      await requireConnectedSdi(deps.channelCredentials, companyId);
    },

    // Issue #499 - see `DocumentTransport.deliversCreditNotes`.
    deliversCreditNotes: true,

    // Issue #526 - see `DocumentTransport.credentialFields`'s own header.
    credentialFields: SDI_CREDENTIAL_FIELDS,
    parseCredentials: extractSdiCredentials,

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      const credentials = await requireConnectedSdi(deps.channelCredentials, ctx.companyId);

      // Issue #499: built from `ctx.formatSource` when the caller set one (a credit note, built from the
      // invoice it corrects), from the delivered invoice itself otherwise (`formatBuildInputOf`).
      const buildInput = formatBuildInputOf(ctx, INVOICE_DESCRIPTOR);
      const data = (buildInput.document.data ?? {}) as Record<string, unknown>;
      const clientId = typeof data.client === 'string' ? data.client : undefined;
      const [company, client] = await Promise.all([
        prisma.company.findUnique({ where: { id: ctx.companyId }, include: { partyIdentifiers: true } }),
        // Scoped by companyId — `clientId` comes straight off the document's own `data.client`, never
        // checked for existence at write time (descriptors/field-kinds.ts's own comment on the
        // 'reference' kind), so a bare `findUnique` would happily hand back another tenant's client. A
        // `null` result (foreign or nonexistent id) already lands on the exact same "no valid client on
        // file" refusal just below that a genuinely absent client already produced.
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
          `Cannot submit to SdI: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      const buildResult = await deps.fatturapaFormatProvider.build(
        buildInput.descriptor,
        buildInput.document,
        companyToFormatParty(company),
        clientToFormatParty(client),
        ctx.companyId,
        buildInput.options,
      );
      if (!buildResult.validation.valid) {
        throw new BadRequestException({
          message: 'Cannot submit to SdI: the generated FatturaPA document failed XSD validation.',
          errors: buildResult.validation.errors,
        });
      }

      const xmlBytes = Buffer.from(buildResult.bytes);
      // Canonical SdI filename pattern: IT{VAT}_{progressive}.xml — the progressive here is derived
      // from the document's own id, the same "derived from the invoice, never invented" convention
      // `pdp-transport.ts` uses for its own `externalId`.
      const filename = `${credentials.idTrasmittente}_${ctx.document.id.slice(-10).replace(/[^a-zA-Z0-9]/g, '0')}.xml`;

      // `deps.httpPort` is the jest-only seam (see this file's own header); a production caller gets
      // a REAL `SdiCoopClient` built from THIS company's own connected `endpoint` — never the old
      // unconditional `UNACCREDITED_SDI_HTTP_PORT` stub, now that a real SOAP client exists. Still,
      // by construction, unproven against the true AdE endpoint (implemented-awaiting-accreditation).
      const sdiClient = new SdiClient(
        deps.httpPort ?? new SdiCoopClient({ endpoint: credentials.endpoint }),
        credentials,
      );

      let idSdI: number | undefined;
      try {
        logger.info('SdI: submitting FatturaPA', {
          category: 'documents',
          details: { companyId: ctx.companyId, filename },
        });
        const result = await sdiClient.submit(xmlBytes, filename);
        idSdI = result.idSdI;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('SdI submission failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` — see async-send.ts's own header: BullMQ's retries
        // get a chance to run before this ever becomes "send_failed". Today this is EVERY call in
        // practice — not because of a stub anymore, but because no company holds real AdE
        // accreditation yet, so `credentials.endpoint` never points at a real, reachable SdI server
        // (see this file's own header, "implemented-awaiting-accreditation").
        throw new BadRequestException(`SdI submission failed: ${message}`);
      }

      if (!idSdI) {
        // THE HARD-SUCCESS CONTRACT: an accepted call with no usable idSdI is a FAILURE, never a
        // silent success — a reference nobody can look up is not a reference at all.
        throw new BadRequestException(
          'SdI accepted the request but returned no usable idSdI — treating this as a failed ' +
            'submission, never a silent success.',
        );
      }

      const reference = String(idSdI);
      logger.info('SdI submission accepted', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, reference },
      });

      return {
        message:
          `Submitted to SdI — idSdI ${reference}. Delivery status (the RC/NS/NE/DT/AT notifiche) is ` +
          "never polled — this channel registers no poller in conformity/ (see that module's own " +
          'header on why) — it arrives PUSHED, over SOAP, to sdi-notifiche.controller.ts instead, ' +
          'and is journaled there against this same idSdI.',
        reference,
        providerId: PROVIDER_ID,
        // Legal archiving — the ONLY artifact this transport ever delivers is
        // the FatturaPA actually submitted (`xmlBytes`, already gated valid above), same reasoning as
        // `pdp-transport.ts`'s own `artifacts`.
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
