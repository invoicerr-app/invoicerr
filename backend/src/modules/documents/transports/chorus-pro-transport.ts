/**
 * The "chorus-pro" transport — this makes the channel the B2G FR rule (`b2g-routing/data/fr.json`)
 * has named since 3cb39f91 actually EXIST. Until now `transportId: "chorus-pro"` resolved against
 * `transport-registry.ts` to nothing on purpose (that commit's own thesis: "a rule may legitimately
 * name a channel not implemented yet" — see that file's own header), and every French GOVERNMENT
 * client's invoice refused, synchronously, naming exactly that gap. Registering this transport under
 * that SAME id closes the gap the ordinary way this codebase already closes every such gap: the rule
 * itself never changes, `resolveB2gInvoiceTransport` (`actions/invoice-actions.ts`) just stops hitting
 * `UnknownTransportError` the moment `documents-core.module.ts` registers this file's own export.
 *
 * Same `DocumentTransport` interface `pdp-transport.ts`/`sdi-transport.ts`/`peppol-transport.ts`
 * implement, registered the same way (`TransportRegistry.register`) — nothing about B2G routing is
 * special-cased here: a company can ALSO choose "chorus-pro" as its own free `invoiceTransportId` for
 * an ordinary client, exactly like any other registered transport (see `transport-registry.ts`'s own
 * header, "nothing here... ever hard-codes which transport a company should use").
 *
 * The client (`chorus-pro/choruspro-client.ts`) is REPRISED from git tag `avant-refonte-documents`
 * (`compliance/providers/transmission/choruspro-client.ts`) — see that file's own header for exactly
 * what was kept verbatim and the two deliberate adaptations. This transport's OWN job is the
 * orchestration around it, the same split `pdp-transport.ts`/`ksef-transport.ts` already hold between
 * "the client speaks the platform's wire protocol" and "the transport resolves credentials, builds the
 * payload, and enforces the hard-success contract".
 *
 * Credentials — TWO layers, both required to be "connected" (see `CREDENTIALS_GUIDE.md` §3, read at
 * the repère and unchanged by this task): a PISTE OAuth2 application (`clientId`/`clientSecret`) AND a
 * Chorus Pro "compte technique" (`technicalAccountLogin`/`technicalAccountPassword`) — PISTE alone
 * authenticates the CALLING APPLICATION, never a specific Chorus Pro structure; without the compte
 * technique there is no `cpro-account` header to send, and every real Chorus Pro API call needs both
 * (`choruspro-client.ts`'s own header). `environment` reuses the SAME generic TEST/PROD selector every
 * sibling channel's settings row already renders (`ResolvedChannelConfig.environment`) — never a
 * second, redundant `config.environment` field the way the repère's own `configSchema` had one.
 *
 * THE RECIPIENT GATE — mirrors `peppol-transport.ts`'s own "this client has no Peppol endpoint on
 * file" guard, for the identical reason: Chorus Pro identifies every public-sector recipient by its
 * SIRET, the SAME `LEGAL_ID` scheme the B2G FR rule's own `requiredClientIdentifiers` names (see
 * `b2g-routing/data/fr.json`) — a B2G send already has this checked upstream (`resolveClientB2gRouting`
 * in `invoice-actions.ts`, re-checked on every `deliver()` replay too), but a company that chose
 * "chorus-pro" as its OWN free transport for a client that never went through the B2G gate at all (the
 * registry is open by design — see this file's own header above) gets NO such upstream check. This
 * guard closes that gap the same way Peppol's own does: refused, named, BEFORE any network call, never
 * a deposit attempted with no way to identify who it is even for. `buyerReference` ("code service" —
 * the B2G rule's own OPTIONAL `requiredDocumentFields` entry) needs no equivalent guard here: it flows
 * through automatically, embedded in the Factur-X content itself, via the SAME generic
 * `formats/shared-build.ts#extractBuyerReference` every other B2G rule in this codebase already reuses
 * (see that rule's own `notes` for why `buyerReference` is shared, not FR-specific) — there is nothing
 * left for THIS transport to additionally read or pass.
 *
 * The payload is `facturx` (`formats/facturx-provider.ts`) — the format the B2G FR rule itself names
 * (`formatSyntax: "facturx"`), gated by the REAL vendored EN 16931 Schematron before this file ever
 * sees the bytes, same discipline every sibling transport already holds; an artifact that fails that
 * gate is NEVER deposited, only refused, named.
 *
 * Two distinct failure shapes, both loud, neither silent — same split every transport in this
 * directory documents:
 *  - `preflight()` — no Chorus Pro channel connected for this company (or an incomplete config) —
 *    thrown BEFORE anything is persisted or queued.
 *  - `send()` — connected, but the deposit itself fails (PISTE auth rejected, network error, an
 *    artifact that failed the Factur-X gate, a client with no SIRET on file, or PISTE answering with no
 *    usable `numeroFluxDepot`) — thrown from inside `deliver()`, so BullMQ's own retries get a chance
 *    to run before this ever becomes `send_failed`.
 * An accepted deposit with an EMPTY `numeroFluxDepot` is the SECOND kind of failure, never a success —
 * this task's own mutation #1 target, the same hard-success contract every transport in this directory
 * already enforces (LIVE_TESTING.md: "a reference nobody can look up is not a reference at all").
 *
 * Post-deposit conformity: `consulterCr` is exactly the kind of pull endpoint
 * `conformity/authority-status-poller.ts` exists for — `conformity/pollers/chorus-pro-status-poller.ts`
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

import {
  ChorusProClient,
  ChorusProClientConfig,
  FetchChorusProHttpPort,
  resolveChorusProSyntax,
} from './chorus-pro/choruspro-client';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentFormatProvider } from '../formats/format-provider';
import { clientToFormatParty, companyToFormatParty } from '../formats/party-snapshot';
import { DocumentTransport, DocumentTransportContext, DocumentTransportResult } from './transport-registry';

export interface ChorusProTransportDeps {
  channelCredentials: ChannelCredentialsService;
  /** The Factur-X provider (`formats/facturx-provider.ts`) — the ONLY payload this transport ever
   *  deposits, the exact syntax the B2G FR rule names (`formatSyntax: "facturx"`), gated by the REAL
   *  vendored EN 16931 Schematron before this file ever sees the bytes. */
  facturxFormatProvider: DocumentFormatProvider;
}

export const CHORUS_PRO_PROVIDER_ID = 'chorus-pro';

/** Same "the invoice's OWN base descriptor, module-level constant" choice every sibling transport
 *  makes for the identical reason — see `pdp-transport.ts`'s own header. */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/**
 * PISTE base URLs — REPRISED from the repère's own `choruspro-transmission.ts#CHORUS_PRO_URLS`, and
 * the sandbox pair independently RE-VERIFIED reachable this task (see `choruspro-client.ts`'s own
 * header for the real `HTTP 400 invalid_client` this checkout observed against it). Fixed by
 * environment, never a user-editable field — same convention `ksef-transport.ts`'s own `BASE_URLS`
 * already holds for the identical reason (a PISTE application's own OAuth/API hosts are a platform
 * fact, not something a company's settings screen should let anyone silently repoint).
 */
export const CHORUS_PRO_URLS = {
  sandbox: {
    oauthBaseUrl: 'https://sandbox-oauth.piste.gouv.fr',
    apiBaseUrl: 'https://sandbox-api.piste.gouv.fr',
  },
  prod: {
    oauthBaseUrl: 'https://oauth.piste.gouv.fr',
    apiBaseUrl: 'https://api.piste.gouv.fr',
  },
} as const;

export interface ChorusProCredentials {
  clientId: string;
  clientSecret: string;
  technicalAccountLogin: string;
  technicalAccountPassword: string;
  environment: 'sandbox' | 'prod';
}

/** Extracts and validates the four fields this transport actually needs out of a resolved config —
 *  shared by `preflight()` and `send()` so neither can drift from what "complete enough to try" means,
 *  same discipline every sibling transport's own `extractCredentials` holds. `environment` comes from
 *  the ROW itself (`ResolvedChannelConfig.environment`), never a second config field — see this file's
 *  own header. */
export function extractChorusProCredentials(resolved: ResolvedChannelConfig): ChorusProCredentials | null {
  const { clientId, clientSecret, technicalAccountLogin, technicalAccountPassword } = resolved.config;
  if (typeof clientId !== 'string' || !clientId) return null;
  if (typeof clientSecret !== 'string' || !clientSecret) return null;
  if (typeof technicalAccountLogin !== 'string' || !technicalAccountLogin) return null;
  if (typeof technicalAccountPassword !== 'string' || !technicalAccountPassword) return null;
  return {
    clientId,
    clientSecret,
    technicalAccountLogin,
    technicalAccountPassword,
    environment: resolved.environment === 'PROD' ? 'prod' : 'sandbox',
  };
}

async function requireConnectedChorusPro(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<ChorusProCredentials> {
  const resolved = await channelCredentials.resolveActive(companyId, CHORUS_PRO_PROVIDER_ID);
  const credentials = resolved && extractChorusProCredentials(resolved);
  if (!credentials) {
    logger.warn('Chorus Pro transport blocked: channel not connected (or incomplete config)', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'The Chorus Pro channel is not connected for this company (a PISTE client id/secret AND a ' +
        'Chorus Pro technical account login/password are all required). Connect it in company ' +
        'settings (Channels → Chorus Pro) before sending an invoice through it — there is no default ' +
        'channel. See CREDENTIALS_GUIDE.md §3 for how to obtain both.',
    );
  }
  return credentials;
}

/** Builds a REAL `ChorusProClient` for this company's connected credentials — one instance per call,
 *  same "no shared, cross-request state beyond the client's own short-lived token cache" choice every
 *  sibling transport's own client construction makes. */
function buildClient(credentials: ChorusProCredentials): ChorusProClient {
  const urls = CHORUS_PRO_URLS[credentials.environment];
  const config: ChorusProClientConfig = { ...urls, ...credentials };
  return new ChorusProClient(config, new FetchChorusProHttpPort());
}

export function buildChorusProTransport(deps: ChorusProTransportDeps): DocumentTransport {
  return {
    async preflight(companyId: string): Promise<void> {
      await requireConnectedChorusPro(deps.channelCredentials, companyId);
    },

    async send(ctx: DocumentTransportContext): Promise<DocumentTransportResult> {
      // Re-resolved rather than trusting the preflight's own result — same reasoning every sibling
      // transport's own `send()` already documents: the company's configuration could have changed in
      // the (possibly long, retried) time between the two calls.
      const credentials = await requireConnectedChorusPro(deps.channelCredentials, ctx.companyId);

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
          `Cannot deposit to Chorus Pro: the ${ctx.label.toLowerCase()} has no valid client on file.`,
        );
      }

      // THE RECIPIENT GATE — see this file's own header. `LEGAL_ID` is the SAME scheme the B2G FR
      // rule's own `requiredClientIdentifiers` names (label "SIRET") — reused, never redeclared.
      const recipientSiret = getIdentifier(client, 'LEGAL_ID');
      if (!recipientSiret) {
        throw new BadRequestException(
          'Cannot deposit to Chorus Pro: this client has no SIRET/SIREN (LEGAL_ID) on file. Set one ' +
            "on the client's own edit screen (Clients → this client → country-specific identifiers) " +
            'before sending — Chorus Pro identifies every public-sector recipient by this number, and ' +
            'guessing one risks depositing against the wrong recipient, or none at all.',
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
        // Same gate `pdp-transport.ts`/`peppol-transport.ts` enforce for their own builds — an
        // artifact that fails the EN 16931 Schematron is NEVER deposited, only refused, named.
        throw new BadRequestException({
          message:
            'Cannot deposit to Chorus Pro: the generated Factur-X document failed EN 16931 validation.',
          errors: buildResult.validation.errors,
        });
      }

      const syntaxeFlux = resolveChorusProSyntax(deps.facturxFormatProvider.syntax);
      const fileName = `facturx-${ctx.document.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      // "code service" (buyerReference) — see this file's own header: already embedded in the Factur-X
      // content by `facturxFormatProvider.build()` above when present; logged here only for
      // traceability, never re-read or re-passed by this transport itself.
      const buyerReference = typeof data.buyerReference === 'string' ? data.buyerReference : undefined;

      logger.info('Chorus Pro: depositing flux', {
        category: 'documents',
        details: {
          companyId: ctx.companyId,
          documentId: ctx.document.id,
          environment: credentials.environment,
          syntaxeFlux,
          buyerReference,
        },
      });

      const chorusProClient = buildClient(credentials);

      let numeroFluxDepot: string;
      try {
        const result = await chorusProClient.deposerFlux(
          Buffer.from(buildResult.bytes),
          fileName,
          syntaxeFlux,
        );
        numeroFluxDepot = result.numeroFluxDepot;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Chorus Pro deposit failed', {
          category: 'documents',
          details: { companyId: ctx.companyId, documentId: ctx.document.id, message },
        });
        // Propagates UNCAUGHT into `deliver()` — see async-send.ts's own header: BullMQ's retries get
        // a chance to run before this ever becomes "send_failed".
        throw new BadRequestException(`Chorus Pro deposit failed: ${message}`);
      }

      if (!numeroFluxDepot) {
        // THE HARD-SUCCESS CONTRACT (LIVE_TESTING.md, and this task's own mutation #1): PISTE
        // answering OK with no usable numeroFluxDepot is a FAILURE, never a silent success — a
        // reference nobody can look up is not a reference at all.
        throw new BadRequestException(
          'Chorus Pro accepted the request but returned no deposit id (numeroFluxDepot) — treating ' +
            'this as a failed deposit, never a silent success.',
        );
      }

      logger.info('Chorus Pro deposit accepted', {
        category: 'documents',
        details: { companyId: ctx.companyId, documentId: ctx.document.id, numeroFluxDepot },
      });

      return {
        message:
          `Deposited to Chorus Pro — flux id ${numeroFluxDepot}. Conformity status (VALIDE/REJETE, or ` +
          'still processing) is tracked by the post-deposit sweep — see ' +
          'conformity/pollers/chorus-pro-status-poller.ts for the timeline.',
        reference: numeroFluxDepot,
        providerId: CHORUS_PRO_PROVIDER_ID,
        // Root TODO item 14 ("archivage légal") — the ONLY artifact this transport ever delivers is
        // the Factur-X actually deposited (already gated valid above), same reasoning every sibling
        // transport's own `artifacts` holds.
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
