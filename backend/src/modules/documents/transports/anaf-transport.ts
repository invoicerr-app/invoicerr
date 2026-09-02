/**
 * The "anaf" transport — Romania's e-Factura national clearance channel, the RO wave this directory's
 * other EU-mandate channels already prove (PDP/Chorus Pro FR, KSeF PL, SdI IT, Peppol cross-border).
 * Same `DocumentTransport` interface every sibling transport implements, registered the same way
 * (`TransportRegistry.register`, `documents-core.module.ts`).
 *
 * The client (`anaf/anaf-client.ts`) is REPRISED and ADAPTED from git tag `avant-refonte-documents`
 * (`compliance/providers/transmission/anaf-client.ts` + `anaf-transmission.ts`) — see that file's own
 * header for the two deliberate departures (the REAL host, the REAL XML response shape) and for why
 * this channel's connected credentials mean a REFRESH token + client id/secret, never a pasted access
 * token or `client_credentials`.
 *
 * ⚖ THE PAYLOAD, HONESTLY — Romania's own CIUS-RO extension is NOT vendored or validated anywhere in
 * this codebase. `formats/ubl-provider.ts` already gates the payload through the REAL, vendored BASE
 * EN 16931 UBL Schematron before this file ever sees the bytes (the same gate `peppol-transport.ts`/
 * `chorus-pro-transport.ts` already enforce for their own syntaxes) — that base layer is genuinely
 * checked, never skipped. What is NOT checked here, and never silently claimed to be, is RO's own
 * additional CIUS-RO ruleset (the Romanian-specific EN 16931 restriction/extension ANAF's own e-Factura
 * validator applies on top of the base standard) — no Schematron/ruleset for it exists anywhere in this
 * checkout (`formats/` carries no `ro`/`cius`-named file — `formats/ubl-provider.ts`'s own header names
 * the ONE sibling this mirrors, `cii-provider.ts`, and neither knows anything RO-specific). Sending a
 * base-EN-16931-valid-but-CIUS-RO-invalid document is therefore a REAL, possible outcome this transport
 * cannot catch locally — ANAF's own `stareMesaj` (`nok`, carrying the authority's own error text — see
 * `conformity/pollers/anaf-status-poller.ts`) is the ONLY judge of that extra layer, exactly the way it
 * should stay until a genuine CIUS-RO ruleset is vendored, never guessed at in its place.
 *
 * NO separate recipient-identifier gate — unlike `peppol-transport.ts`'s own "no Peppol endpoint on
 * file" guard or `chorus-pro-transport.ts`'s own "no SIRET on file" guard: the repère's own upload call
 * (`PUT .../upload?standard=UBL&cif={cif}`) never took a buyer identifier as a separate parameter, only
 * the SELLER's own CIF — already required by `preflight()` below, as part of the connected channel
 * config. The buyer's own Romanian CIF (when the buyer is itself Romanian) is content EMBEDDED in the
 * UBL document's own BuyerParty block, built by the SAME shared EU-invoice bridge every format provider
 * already uses — never a second, ANAF-specific field this transport reads or re-validates separately.
 * Inventing a gate the repère's own logic never needed would be exactly the kind of guessed requirement
 * this codebase's own ⚖ discipline forbids.
 *
 * Two distinct failure shapes, both loud, neither silent — same split every transport in this
 * directory documents:
 *  - `preflight()` — no ANAF channel connected for this company (or an incomplete config) — thrown
 *    BEFORE anything is persisted or queued.
 *  - `send()` — connected, but the upload itself fails (auth/network error, an artifact that failed
 *    the base EN 16931 gate, or ANAF answering with no usable `index_incarcare`) — thrown from inside
 *    `deliver()`, so BullMQ's own retries get a chance to run before this ever becomes `send_failed`.
 * An accepted upload with an EMPTY `index_incarcare` is the SECOND kind of failure, never a success —
 * this task's own mutation #1 target, the same hard-success contract every transport in this directory
 * already enforces (LIVE_TESTING.md: "a reference nobody can look up is not a reference at all").
 *
 * Post-upload conformity: `stareMesaj` is exactly the kind of pull endpoint
 * `conformity/authority-status-poller.ts` exists for — `conformity/pollers/anaf-status-poller.ts`
 * registers one, the same shape `pdp-status-poller.ts`/`chorus-pro-status-poller.ts` already hold.
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
import { AnafClient } from './anaf/anaf-client';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

export interface AnafTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The base EN 16931 UBL provider (`formats/ubl-provider.ts`) — the ONLY payload this transport
   *  ever sends, gated by the REAL vendored base Schematron before this file ever sees the bytes. See
   *  this file's own header, "THE PAYLOAD, HONESTLY", for what that gate does NOT additionally cover
   *  (RO's own CIUS-RO extension). */
  ublFormatProvider: DocumentFormatProvider;
}

export const ANAF_PROVIDER_ID = 'anaf';

/** Same "the invoice's OWN base descriptor, module-level constant" choice every sibling transport
 *  makes for the identical reason — see `pdp-transport.ts`'s own header. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/**
 * ANAF's own fixed hosts, by environment — REAL, independently verified (this file's own header, and
 * `anaf/anaf-client.ts`'s own header) against ANAF's own published endpoint page, never the repère's
 * own unverified guess. Fixed, never a user-editable field — the same convention
 * `chorus-pro-transport.ts`'s own `CHORUS_PRO_URLS`/`ksef-transport.ts`'s own `BASE_URLS` already hold
 * for the identical reason (a national platform's own API host is a platform fact, not something a
 * company's settings screen should let anyone silently repoint). The OAuth token host is the SAME for
 * both environments — `CREDENTIALS_GUIDE.md` §5: "ANAF does not separate test vs prod OAuth apps or
 * certificates".
 */
export const ANAF_URLS = {
  TEST: { baseUrl: 'https://webserviceapl.anaf.ro/test/FCTEL/rest' },
  PROD: { baseUrl: 'https://webserviceapl.anaf.ro/prod/FCTEL/rest' },
} as const;
export const ANAF_TOKEN_URL = 'https://logincert.anaf.ro/anaf-oauth2/v1/token';

export interface AnafCredentials {
  cif: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Extracts and validates the four fields this transport actually needs out of a resolved config —
 *  shared by `preflight()` and `send()` so neither can drift from what "complete enough to try" means,
 *  same discipline every sibling transport's own `extractCredentials` holds. */
export function extractAnafCredentials(resolved: ResolvedChannelConfig): AnafCredentials | null {
  const { cif, clientId, clientSecret, refreshToken } = resolved.config;
  if (typeof cif !== 'string' || !cif) return null;
  if (typeof clientId !== 'string' || !clientId) return null;
  if (typeof clientSecret !== 'string' || !clientSecret) return null;
  if (typeof refreshToken !== 'string' || !refreshToken) return null;
  return { cif, clientId, clientSecret, refreshToken };
}

/** Builds a REAL `AnafClient` for this company's connected credentials — one instance per call, same
 *  "no shared, cross-request state beyond the client's own short-lived token cache" choice every
 *  sibling transport's own client construction makes. Exported so
 *  `conformity/pollers/anaf-status-poller.ts` builds the identical client, never a second construction
 *  path that could drift from this one. */
export function buildAnafClient(credentials: AnafCredentials, environment: string): AnafClient {
  const urls = environment === 'PROD' ? ANAF_URLS.PROD : ANAF_URLS.TEST;
  return new AnafClient({ ...urls, tokenUrl: ANAF_TOKEN_URL, ...credentials });
}

async function requireConnectedAnaf(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<{ credentials: AnafCredentials; environment: string }> {
  const resolved = await channelCredentials.resolveActive(companyId, ANAF_PROVIDER_ID);
  const credentials = resolved && extractAnafCredentials(resolved);
  if (!resolved || !credentials) {
    logger.warn('ANAF transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The ANAF channel is not connected for this company (a Romanian CIF, an OAuth client id/secret, ' +
        'and a refresh token are all required). Connect it in company settings (Channels → ANAF) before ' +
        'sending an invoice through it — there is no default channel. See CREDENTIALS_GUIDE.md §5 for ' +
        'how to obtain the refresh token — it requires a qualified Romanian certificate, presented once, ' +
        'interactively.',
    );
  }
  return { credentials, environment: resolved.environment };
}

export function buildAnafTransport(deps: AnafTransportDeps): DocumentTransport {
  return {
    async preflight(companyId: string): Promise<void> {
      await requireConnectedAnaf(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      // Re-resolved rather than trusting the preflight's own result — same reasoning every sibling
      // transport's own `send()` already documents.
      const { credentials, environment } = await requireConnectedAnaf(deps.channelCredentials, ctx.companyId);

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
          `Cannot send via ANAF: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      const buildResult = await deps.ublFormatProvider.build(
        INVOICE_DESCRIPTOR,
        ctx.document,
        companyToFormatParty(company),
        clientToFormatParty(client),
      );
      if (!buildResult.validation.valid) {
        // Same gate every sibling transport enforces for its own build — an artifact that fails the
        // base EN 16931 Schematron is NEVER uploaded, only refused, named. See this file's own header,
        // "THE PAYLOAD, HONESTLY", for what this gate does NOT additionally cover (CIUS-RO).
        throw new BadRequestException({
          message: 'Cannot send via ANAF: the generated UBL document failed EN 16931 validation.',
          errors: buildResult.validation.errors,
        });
      }

      const xml = Buffer.from(buildResult.bytes).toString('utf-8');
      const anafClient = buildAnafClient(credentials, environment);

      let idIncarcare: string;
      try {
        const result = await anafClient.uploadInvoice(xml);
        idIncarcare = result.idIncarcare;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('ANAF upload failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` — see async-send.ts's own header: BullMQ's retries get
        // a chance to run before this ever becomes "send_failed".
        throw new BadRequestException(`ANAF upload failed: ${message}`);
      }

      // `AnafClient#uploadInvoice` already throws rather than returning an empty id (this file's own
      // hard-success contract) — this check stays as defence-in-depth, the same belt-and-suspenders
      // choice `pdp-transport.ts`/`peppol-transport.ts` keep even though their own clients hold the
      // same guarantee.
      if (!idIncarcare) {
        throw new BadRequestException(
          'ANAF accepted the request but returned no upload id (index_incarcare) — treating this as a ' +
            'failed upload, never a silent success.',
        );
      }

      logger.info('ANAF upload accepted', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, idIncarcare },
      });

      return {
        message:
          `Uploaded to ANAF e-Factura — index de chargement (index_incarcare) ${idIncarcare}. Conformity ` +
          "status (ANAF's own stareMesaj: ok/nok) is tracked by the post-upload sweep — see " +
          "conformity/pollers/anaf-status-poller.ts. Base EN 16931 UBL is validated locally; Romania's " +
          "own CIUS-RO extension is judged by ANAF itself, not by this codebase — see this file's own " +
          'header, "THE PAYLOAD, HONESTLY".',
        reference: idIncarcare,
        providerId: ANAF_PROVIDER_ID,
        // Root TODO item 14 ("archivage légal") — the ONLY artifact this transport ever delivers is
        // the UBL document actually uploaded (already gated valid above), same reasoning every sibling
        // transport's own `artifacts` holds.
        artifacts: [
          {
            role: deps.ublFormatProvider.id,
            mime: deps.ublFormatProvider.mime,
            bytes: buildResult.bytes,
          },
        ],
      };
    },
  };
}
