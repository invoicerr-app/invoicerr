/**
 * The "sdi" transport — root TODO item 10 ("transports nationaux"), wave 2: Italy's Sistema di
 * Interscambio. Same `DocumentTransport` interface `pdp-transport.ts`/`ksef-transport.ts` implement,
 * registered the same way.
 *
 * Unlike KSeF (proven live at the repère), SdI's own real submission was NEVER proven — the repère's
 * own `sdi-transmission.ts` already threw an honest "not implemented" error from its default HTTP
 * port because a real SDICoop SOAP client requires AdE (Agenzia delle Entrate) intermediary
 * accreditation and a qualified PFX certificate, NEITHER obtained then, NOR now (see this task's own
 * report). This file REPRISES that exact honesty rather than inventing a working transport that does
 * not exist: `sdi/sdi-client.ts`'s `UNACCREDITED_SDI_HTTP_PORT` is what a real deployment gets today,
 * and `send()` genuinely fails with a NAMED error the moment it is reached — never a silent success.
 * `SdiTransportDeps.httpPort` is the seam a future accredited SOAP client plugs into (and the seam
 * this wave's OWN jest spec uses to prove the orchestration around it, mocked — see that spec's own
 * header), the same DI shape `facturx-provider.ts`'s factory already holds for an unrelated reason.
 *
 * Two distinct failure shapes, both loud, neither silent — same split every transport in this
 * directory documents:
 *  - `preflight()` — no SdI channel connected for this company (missing idTrasmittente/certificate)
 *    — thrown BEFORE anything is persisted or queued.
 *  - `send()` — connected, but the submission itself fails (today: ALWAYS, via the honest
 *    unaccredited stub, until a real SOAP port is injected) — thrown from inside `deliver()`, so
 *    BullMQ's own retries run before `send_failed` is ever recorded.
 * An accepted submission with an EMPTY `idSdI` is the second kind of failure, never a success — the
 * same hard-success contract every transport in this directory enforces.
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
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';
import { SdiClient, SdiHttpPort, UNACCREDITED_SDI_HTTP_PORT } from './sdi/sdi-client';

export interface SdiTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The FatturaPA provider (`formats/national/fatturapa-provider.ts`) — the ONLY payload this
   *  transport ever submits, gated by the REAL vendored `Schema_VFPR12.xsd`. */
  fatturapaFormatProvider: DocumentFormatProvider;
  /** Injectable ONLY for tests (see this file's own header) — a production caller omits this and
   *  gets `UNACCREDITED_SDI_HTTP_PORT`, the honest "not accredited yet" stub. */
  httpPort?: SdiHttpPort;
}

const PROVIDER_ID = 'sdi';

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

interface SdiCredentials {
  idTrasmittente: string;
  certificate: string;
  certificatePassword?: string;
}

/** Extracts and validates the fields this transport needs — shared by `preflight()` and `send()`.
 *  Only `idTrasmittente`/`certificate` gate "connected" (per this item's own brief); a certificate
 *  password is common but not universal (some PFX files carry none), so it is read through when
 *  present without being required here. */
function extractCredentials(resolved: ResolvedChannelConfig): SdiCredentials | null {
  const { idTrasmittente, certificate, certificatePassword } = resolved.config;
  if (typeof idTrasmittente !== 'string' || !idTrasmittente) return null;
  if (typeof certificate !== 'string' || !certificate) return null;
  return {
    idTrasmittente,
    certificate,
    certificatePassword: typeof certificatePassword === 'string' ? certificatePassword : undefined,
  };
}

async function requireConnectedSdi(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<SdiCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, PROVIDER_ID);
  const credentials = resolved && extractCredentials(resolved);
  if (!credentials) {
    logger.warn('SdI transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The SdI channel is not connected for this company. Connect it in company settings ' +
        '(Channels → SdI) before sending an invoice through it — there is no default channel.',
    );
  }
  return credentials;
}

export function buildSdiTransport(deps: SdiTransportDeps): DocumentTransport {
  return {
    async preflight(companyId: string): Promise<void> {
      await requireConnectedSdi(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      const credentials = await requireConnectedSdi(deps.channelCredentials, ctx.companyId);

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
          `Cannot submit to SdI: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      const buildResult = await deps.fatturapaFormatProvider.build(
        INVOICE_DESCRIPTOR,
        ctx.document,
        companyToFormatParty(company),
        clientToFormatParty(client),
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

      const sdiClient = new SdiClient(deps.httpPort ?? UNACCREDITED_SDI_HTTP_PORT, credentials);

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
        // get a chance to run before this ever becomes "send_failed". Today, with no httpPort
        // injected, this is EVERY call — see this file's own header on why that is the honest state.
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
          'still not tracked — those are PUSHED to us over SOAP, not polled, so this channel has no ' +
          "poller registered in conformity/ (see that module's own header on why).",
        reference,
        providerId: PROVIDER_ID,
        // Root TODO item 14 ("archivage légal") — the ONLY artifact this transport ever delivers is
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
