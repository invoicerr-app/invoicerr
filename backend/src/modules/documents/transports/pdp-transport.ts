/**
 * The "pdp" transport — root TODO item 10 ("transports nationaux"), wave 1: France's Plateforme de
 * Dématérialisation Partenaire. Same `DocumentTransport` interface `email-transport.ts` implements
 * (registered under `TransportRegistry` exactly like it — see that file's own header on why a
 * company opts in via `Company.invoiceTransportId`, nothing here treated specially).
 *
 * The client (`pdp/pdp-client.ts`) and the round-trip shape are REPRISED from git tag
 * `avant-refonte-documents` — a real deposit was proven end-to-end there (fr:200→201→202, superpdp
 * sandbox, 2026-08-29). This wave's own contract is narrower than what that engine eventually
 * reached: a deposit SUCCEEDS the moment superpdp ACCEPTS the upload (a non-empty invoice id back
 * from `POST /v1.beta/invoices`) — following the conformity verdict through fr:201/202 needs a
 * POLLER (the old engine's `InboxPoller`), which is consigned to TODO_ISSUES.md as this item's
 * named remainder, not guessed at here.
 *
 * Two distinct failure shapes, both loud, neither silent:
 *  - `preflight()` — no PDP channel connected for this company (or an incomplete config) — thrown
 *    BEFORE anything is persisted or queued (see `transport-registry.ts`'s own `preflight` header
 *    and `invoice-actions.ts`'s "send" preflight, which calls this).
 *  - `send()` — connected, but the deposit itself fails (network/auth error, or superpdp answers
 *    with no usable deposit id) — thrown from inside `deliver()`, so BullMQ's own retries get a
 *    chance to run before `send_failed` is ever recorded (see `actions/async-send.ts`'s own header).
 * An accepted deposit with an EMPTY id is treated as the SECOND kind of failure, never a success —
 * this task's own hard-success contract (LIVE_TESTING.md): a reference nobody can look up is not a
 * reference at all.
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
import { PdpClient } from './pdp/pdp-client';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

export interface PdpTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The Factur-X provider (`formats/facturx-provider.ts`) — the PDP payload for this wave (see this
   *  file's own header: the round-trip's PROVEN artifact at the repère was raw CII, but this wave's
   *  task explicitly asks for Factur-X, and the format provider already gates the embedded CII
   *  through the identical Schematron `cii-provider.ts` uses — never an unvalidated artifact sent). */
  facturxFormatProvider: DocumentFormatProvider;
}

const PROVIDER_ID = 'pdp';

/** Same "the invoice's OWN base descriptor, module-level constant" choice `invoice-actions.ts` makes
 *  for the identical reason — this transport is reached ONLY through `invoiceTransportId` (see
 *  `transport-registry.ts`'s own header: "See invoice-actions.ts's 'send' for the one caller
 *  today"), so it is always an invoice, never another document type, that this file ever builds a
 *  payload for. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

interface PdpCredentials {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

/** Extracts and validates the three fields this transport actually needs out of a resolved config —
 *  shared by `preflight()` and `send()` so neither can drift from what "complete enough to try" means. */
function extractCredentials(resolved: ResolvedChannelConfig): PdpCredentials | null {
  const { baseUrl, clientId, clientSecret } = resolved.config;
  if (typeof baseUrl !== 'string' || !baseUrl || typeof clientId !== 'string' || !clientId) return null;
  if (typeof clientSecret !== 'string' || !clientSecret) return null;
  return { baseUrl, clientId, clientSecret };
}

async function requireConnectedPdp(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<PdpCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, PROVIDER_ID);
  const credentials = resolved && extractCredentials(resolved);
  if (!credentials) {
    logger.warn('PDP transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The PDP channel is not connected for this company. Connect it in company settings ' +
        '(Channels → PDP) before sending an invoice through it — there is no default channel.',
    );
  }
  return credentials;
}

export function buildPdpTransport(deps: PdpTransportDeps): DocumentTransport {
  return {
    // Runs BEFORE anything is persisted or queued (see this file's own header) — checks ONLY that a
    // usable connection exists; the actual deposit is attempted in `send()` below, at delivery time.
    async preflight(companyId: string): Promise<void> {
      await requireConnectedPdp(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      // Re-resolved rather than trusting the preflight's own result — same reasoning
      // `resolveInvoiceTransport` already documents for its own re-resolution in `deliver()`: the
      // company's configuration could have changed in the (possibly long, retried) time between the
      // two calls.
      const credentials = await requireConnectedPdp(deps.channelCredentials, ctx.companyId);

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
          `Cannot deposit to PDP: the ${ctx.label.toLowerCase()} has no valid client on file.`,
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
        // Same gate `documents.service.ts#downloadDocumentFormat` enforces for a manual download —
        // an invalid EN 16931 artifact is never deposited either, just like it is never served.
        throw new BadRequestException({
          message: 'Cannot deposit to PDP: the generated Factur-X document failed EN 16931 validation.',
          errors: buildResult.validation.errors,
        });
      }

      const pdpClient = new PdpClient({ ...credentials, apiStyle: 'superpdp' });

      let depositId: string;
      try {
        await pdpClient.authenticate();
        const invoice = await pdpClient.sendInvoice(buildResult.bytes, {
          externalId: ctx.document.displayNumber ?? ctx.document.id,
        });
        depositId = invoice?.id != null ? String(invoice.id) : '';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('PDP deposit failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` — see async-send.ts's own header: BullMQ's retries
        // get a chance to run before this ever becomes "send_failed".
        throw new BadRequestException(`PDP deposit failed: ${message}`);
      }

      if (!depositId) {
        // THE HARD-SUCCESS CONTRACT (LIVE_TESTING.md, and this task's own mutation #1): an accepted
        // upload with no usable deposit id is a FAILURE, never a silent success — a reference nobody
        // can look up on the platform is not a reference at all.
        throw new BadRequestException(
          'PDP accepted the request but returned no deposit id — treating this as a failed deposit, ' +
            'never a silent success.',
        );
      }

      logger.info('PDP deposit accepted', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, depositId },
      });

      return {
        message:
          `Deposited to the PDP — deposit id ${depositId}. Conformity status not tracked yet ` +
          "(polling is TODO_ISSUES.md's named remainder of this item).",
        reference: depositId,
      };
    },
  };
}
