/**
 * The "sdi-pec" transport — Italy's Sistema di Interscambio (SdI), reached over a certified-email
 * (PEC) mailbox rather than the accredited SDICoop web service `sdi-transport.ts` implements. Same
 * `DocumentTransport` interface every transport in this directory implements, registered the same way
 * (`documents-core.module.ts`'s own `buildTransportRegistry`).
 *
 * ## Why this exists
 *
 * `sdi-transport.ts`'s own header already states it: SDICoop requires AdE (Agenzia delle Entrate)
 * intermediary accreditation and a qualified PFX certificate this project's owner cannot obtain — so
 * that transport stays implemented-awaiting-accreditation forever. The PEC route requires NEITHER: any
 * sender with a PEC mailbox can email the FatturaPA XML straight to SdI's own PEC address. See
 * `transports/sdi-pec/pec-protocol.ts`'s own header for the full primary-source citation this fact and
 * every other protocol detail below rest on — this file only ever encodes what that module already
 * established, never a second copy of the same research.
 *
 * ## Same payload, different transport
 *
 * The FatturaPA XML itself does not differ between the two routes (`pec-protocol.ts`'s own header,
 * "What differs between the PEC route and the SdICoop route" — nothing, in the XML) — this transport
 * reuses the exact same `fatturapaFormatProvider` (`formats/national/fatturapa-provider.ts`)
 * `sdi-transport.ts` already builds against, gated by the same real vendored `Schema_VFPR12.xsd`.
 *
 * ## Credentials — reused, not invented
 *
 * A "sdi-pec" channel config carries a PEC mailbox's own connection details (`SdiPecCredentials`
 * below) through the EXACT SAME per-company `ChannelCredentialsService` every other transport in this
 * module already uses (`modules/company/channels/channels.service.ts`) — no second credentials
 * mechanism. Sending itself goes through `MailService`'s own existing per-company SMTP path
 * (`SmtpOverrides`, the mechanism `email-transport.ts` already relies on) — this transport supplies a
 * PEC mailbox's own SMTP details as those same overrides rather than building a second mail-sending
 * code path.
 *
 * ## The reference this transport hands back
 *
 * Unlike `pdp-transport.ts`/`ksef-transport.ts`/`sdi-transport.ts`, which all get an authoritative
 * platform-assigned id SYNCHRONOUSLY on submission, a PEC send only ever proves "handed to the next
 * mail hop" — SdI's own `IdentificativoSdI` is assigned LATER and arrives asynchronously, in the first
 * notifica (`transports/sdi-pec/pec-notifiche.service.ts`). So `reference` here is the FILENAME this
 * transport itself chose (`pec-protocol.ts#buildPecAttachmentFilename`, drawn from a persistent
 * per-idTrasmittente counter — see that function's own header for why, never derived from the document
 * id any more) — a genuinely usable reference (unique, chosen before sending, and the exact key every
 * one of SdI's six notifica types echoes back in its own `NomeFile` field), satisfying the same hard-success
 * contract every transport in this directory enforces ("accepted with no usable reference is a
 * failure") without pretending to know an `IdentificativoSdI` that does not exist yet.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import { MailService } from '@/mail/mail.service';
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';
import prisma from '@/prisma/prisma.service';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentFormatProvider } from '../formats/format-provider';
import { clientToFormatParty, companyToFormatParty } from '../formats/party-snapshot';
import {
  buildPecAttachmentFilename,
  PEC_RAW_ATTACHMENT_SAFE_MAX_BYTES,
  resolvePecRecipient,
} from './sdi-pec/pec-protocol';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

export interface SdiPecTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The FatturaPA provider (`formats/national/fatturapa-provider.ts`) — the same one
   *  `sdi-transport.ts` builds against; see this file's own header, "Same payload, different
   *  transport". */
  fatturapaFormatProvider: DocumentFormatProvider;
  mailService: MailService;
}

export const SDI_PEC_PROVIDER_ID = 'sdi-pec';

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

interface SdiPecCredentials {
  /** This company's OWN PEC mailbox address — the SMTP envelope/header From, and the account whose
   *  inbox `pec-inbox-poller.service.ts` later drains for replies. */
  pecAddress: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password: string;
  /** Same field, same shape, same convention as `sdi-transport.ts#SdiCredentials.idTrasmittente` —
   *  the `IT<fiscalId>`-style identifier stamped in the FatturaPA header AND used to build the PEC
   *  attachment filename (`pec-protocol.ts#buildPecAttachmentFilename`). */
  idTrasmittente: string;
  /** LEARNED, never configured by hand — `pec-notifiche.service.ts` populates this once SdI's own
   *  first reply names the address every later submission must target (`pec-protocol.ts`'s own
   *  header, the two-step addressing rule). Absent until that first reply has actually been observed. */
  sdiReplyAddress?: string;
}

/** Extracts and validates the fields this transport needs — shared by `preflight()` and `send()`, the
 *  same split `sdi-transport.ts#extractCredentials` already holds. `smtpSecure` defaults to `false`
 *  when absent (most PEC providers' documented SMTP submission port is either always-TLS or
 *  STARTTLS-capable on 587 — nothing in the read specification pins one specific provider's port
 *  convention, so this is a permissive default a company's own settings screen is expected to
 *  override, never a fact claimed from a source). `sdiReplyAddress` stays optional — its ABSENCE is the
 *  ordinary state for a company that has never sent through this channel yet. */
function extractCredentials(resolved: ResolvedChannelConfig): SdiPecCredentials | null {
  const { pecAddress, smtpHost, smtpPort, smtpSecure, username, password, idTrasmittente, sdiReplyAddress } =
    resolved.config;
  if (typeof pecAddress !== 'string' || !pecAddress) return null;
  if (typeof smtpHost !== 'string' || !smtpHost) return null;
  if (typeof smtpPort !== 'number' || !Number.isFinite(smtpPort) || smtpPort <= 0) return null;
  if (typeof username !== 'string' || !username) return null;
  if (typeof password !== 'string' || !password) return null;
  if (typeof idTrasmittente !== 'string' || !idTrasmittente) return null;
  return {
    pecAddress,
    smtpHost,
    smtpPort,
    smtpSecure: smtpSecure === true,
    username,
    password,
    idTrasmittente,
    sdiReplyAddress: typeof sdiReplyAddress === 'string' && sdiReplyAddress ? sdiReplyAddress : undefined,
  };
}

async function requireConnectedSdiPec(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<SdiPecCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, SDI_PEC_PROVIDER_ID);
  const credentials = resolved && extractCredentials(resolved);
  if (!credentials) {
    logger.warn('SdI-via-PEC transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The SdI-via-PEC channel is not connected for this company (a PEC mailbox address, SMTP host/' +
        'port, username/password, and idTrasmittente are all required). Connect it in company ' +
        'settings (Channels → SdI via PEC) before sending an invoice through it — there is no default ' +
        'channel. Unlike the SDICoop channel, this one requires NO AdE accreditation: any PEC mailbox ' +
        'works ("Inviare la FatturaPA", fatturapa.gov.it: «L\'utilizzo del canale PEC non presuppone ' +
        'alcun tipo di accreditamento preventivo presso il Sistema di Interscambio.»).',
    );
  }
  return credentials;
}

export function buildSdiPecTransport(deps: SdiPecTransportDeps): DocumentTransport {
  return {
    async preflight(companyId: string): Promise<void> {
      await requireConnectedSdiPec(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      const credentials = await requireConnectedSdiPec(deps.channelCredentials, ctx.companyId);

      const data = (ctx.document.data ?? {}) as Record<string, unknown>;
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
              include: { partyIdentifiers: true },
            })
          : Promise.resolve(null),
      ]);
      if (!company) {
        throw new BadRequestException(`Company "${ctx.companyId}" not found.`);
      }
      if (!client) {
        throw new BadRequestException(
          `Cannot submit to SdI via PEC: the ${ctx.label.toLowerCase()} has no valid client on file.`,
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
          message: 'Cannot submit to SdI via PEC: the generated FatturaPA document failed XSD validation.',
          errors: buildResult.validation.errors,
        });
      }

      const xmlBytes = Buffer.from(buildResult.bytes);
      if (xmlBytes.length > PEC_RAW_ATTACHMENT_SAFE_MAX_BYTES) {
        // See pec-protocol.ts's own header on PEC_RAW_ATTACHMENT_SAFE_MAX_BYTES — a conservative
        // safety margin under the read 30 MB message ceiling, refused HERE rather than as an opaque
        // bounce from the PEC provider later.
        throw new BadRequestException(
          `Cannot submit to SdI via PEC: the generated FatturaPA document is ${xmlBytes.length} bytes, ` +
            `over this transport's own safety margin (${PEC_RAW_ATTACHMENT_SAFE_MAX_BYTES} bytes, ` +
            "reserved under the PEC channel's own 30 MB whole-message limit for base64 inflation and " +
            'envelope overhead).',
        );
      }

      let filename: string;
      try {
        filename = await buildPecAttachmentFilename(credentials.idTrasmittente);
      } catch (error) {
        // A malformed idTrasmittente (bad channel config) fails HERE, named — never an opaque SdI
        // rejection days later. See pec-protocol.ts#buildPecAttachmentFilename's own error text.
        throw new BadRequestException(
          `Cannot submit to SdI via PEC: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const recipient = resolvePecRecipient(credentials.sdiReplyAddress);

      try {
        logger.info('SdI-via-PEC: submitting FatturaPA', {
          category: 'documents',
          details: { companyId: ctx.companyId, filename, recipient },
        });
        await deps.mailService.sendMail(
          {
            to: recipient,
            subject: `Fattura elettronica — ${filename}`,
            text:
              `In allegato la fattura elettronica ${filename}, trasmessa al Sistema di Interscambio ` +
              'tramite Posta Elettronica Certificata (PEC).',
            attachments: [{ filename, content: xmlBytes, contentType: 'application/xml' }],
          },
          {
            host: credentials.smtpHost,
            port: credentials.smtpPort,
            secure: credentials.smtpSecure,
            username: credentials.username,
            password: credentials.password,
            fromAddress: credentials.pecAddress,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('SdI-via-PEC submission failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates as a named, loud failure — same "never silent" contract sdi-transport.ts's own
        // send() holds; BullMQ's own retries (async-send.ts) get a chance to run before this ever
        // becomes "send_failed".
        throw new BadRequestException(`SdI PEC submission failed: ${message}`);
      }

      logger.info('SdI-via-PEC submission handed to the mail transport', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, filename, recipient },
      });

      return {
        message:
          `Submitted to SdI via PEC — attachment ${filename}, sent to ${recipient}. This only confirms ` +
          "the message reached the next mail hop, never SdI's own processing: the actual outcome " +
          '(RC/NS/MC/NE/DT/AT) arrives later, drained from this mailbox by pec-inbox-poller.service.ts ' +
          'and journaled against this same filename.',
        reference: filename,
        providerId: SDI_PEC_PROVIDER_ID,
        // Legal archiving — the FatturaPA actually submitted, same reasoning as sdi-transport.ts's own
        // `artifacts` (already gated valid above).
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
