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
 * Same `DocumentTransport` interface `pdp-transport.ts`/`sdi-transport.ts` implement, registered the
 * same way (`TransportRegistry.register`) — nothing about B2G routing is
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
 * Credentials — TWO layers, both required to be "connected" (see `documentation/docs/developer-guide/credentials-guide.md` §3, read at
 * the reference, unchanged): a PISTE OAuth2 application (`clientId`/`clientSecret`) AND a
 * Chorus Pro "compte technique" (`technicalAccountLogin`/`technicalAccountPassword`) — PISTE alone
 * authenticates the CALLING APPLICATION, never a specific Chorus Pro structure; without the compte
 * technique there is no `cpro-account` header to send, and every real Chorus Pro API call needs both
 * (`choruspro-client.ts`'s own header). `environment` reuses the SAME generic TEST/PROD selector every
 * sibling channel's settings row already renders (`ResolvedChannelConfig.environment`) — never a
 * second, redundant `config.environment` field the way the reference's own `configSchema` had one.
 *
 * THE RECIPIENT GATE — the same shape every sibling transport's own receiver check holds (e.g.
 * `pdp-transport.ts`'s own missing-identifier refusal): Chorus Pro identifies every public-sector
 * recipient by its SIRET, the SAME `LEGAL_ID` scheme the B2G FR rule's own `requiredClientIdentifiers`
 * names (see `b2g-routing/data/fr.json`) — a B2G send already has this checked upstream
 * (`resolveClientB2gRouting` in `invoice-actions.ts`, re-checked on every `deliver()` replay too), but
 * a company that chose "chorus-pro" as its OWN free transport for a client that never went through the
 * B2G gate at all (the registry is open by design — see this file's own header above) gets NO such
 * upstream check. This guard closes that gap: refused, named, BEFORE any network call, never a deposit
 * attempted with no way to identify who it is even for. `buyerReference` ("code service" —
 * the B2G rule's own OPTIONAL `requiredDocumentFields` entry) needs no equivalent guard here: it flows
 * through automatically, embedded in the Factur-X content itself, via the SAME generic
 * `formats/shared-build.ts#extractBuyerReference` every other B2G rule in this codebase already reuses
 * (see that rule's own `notes` for why `buyerReference` is shared, not FR-specific) — there is nothing
 * left for THIS transport to additionally read or pass.
 *
 * THE PAYMENT MEANS GATE — the SELLER-side twin of the recipient gate above, closing the OTHER half of
 * a real rejection measured live 2026-09-14 (`flux CPP0011117000000000425895`, DEPOSE→IN_REJETE,
 * `ApplicableHeaderTradeSettlement.SpecifiedTradeSettlementPaymentMeans.TypeCode.value est
 * obligatoire`). BT-81 (Payment means type code, BG-16) is OPTIONAL at the base EN 16931 layer — the
 * vendored Schematron's own BR-49 (`formats/vendored/en16931/EN16931-CII-validation-preprocessed.sch`)
 * only fires once `SpecifiedTradeSettlementPaymentMeans` EXISTS, so an artifact with the block entirely
 * absent still passes the Factur-X gate below — but Chorus Pro's OWN data model requires it
 * UNCONDITIONALLY: AIFE's "Dossier de spécifications externes de Chorus Pro — Annexe relative au
 * raccordement EDI", V4.20, p.22 ("Entité Données Facture") marks "Mode de paiement" "O" (Obligatoire).
 * STRICT ALLOWLIST (owner's decision, 2026-09-14 — see `CHORUS_PRO_ALLOWED_PAYMENT_METHOD_ID`'s own
 * header for the full per-method sourcing): derived from this company's own CONFIGURED payment
 * methods (`payment-methods/persistence.ts#listCompanyPaymentMethods`), never from `Company.iban`
 * alone — a company that once typed an IBAN but has since disabled "Bank transfer" in its own
 * payment-methods settings must not have Chorus Pro silently keep declaring a bank transfer on its
 * behalf. Only "bank_transfer" (code '30') passes; every other built-in method is refused, named,
 * explaining WHY a public buyer cannot use it — a company with none of the accepted method(s)
 * configured, or with "bank_transfer" enabled but no `Company.iban` on file (a real, reachable state:
 * the general company-settings PATCH — `company.service.ts` — can null `iban` directly, independent
 * of the payment-methods "enabled" flag), is refused HERE, named, before any network call, same shape
 * as the recipient gate above.
 *
 * THE INVOICE NUMBER LENGTH GATE — closes the OTHER new error from the SAME 2026-09-14 rejection
 * sequence (`flux CPP0011117000000000425899`): "Le champ identifiant de la facture
 * (FichierXml.ExchangedDocument.ID.value) ne doit pas depasser 20 caracteres". BT-1 has no length
 * limit at the base EN 16931 layer — this is a Chorus-Pro-specific constraint (AIFE's own annex, rule
 * G1.05 — see `CHORUS_PRO_INVOICE_NUMBER_PATTERN`'s own header), so it belongs HERE, not in the
 * generic, channel-agnostic `numbering/` module every OTHER channel would then also be constrained by.
 * Nothing in this product's numbering screen (`Company.numberFormats`) stops a company from choosing a
 * pattern that produces a number over 20 characters — this gate is what turns that mistake into an
 * immediate, named refusal instead of a deposit rejected hours later.
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
 * the same hard-success contract every transport in this directory
 * already enforces (documentation/docs/developer-guide/live-testing.md: "a reference nobody can look up is not a reference at all").
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
import { listCompanyPaymentMethods } from '../payment-methods/persistence';
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
 * BT-1 (Invoice number) — Chorus Pro's OWN length/charset limit, independent of the base EN 16931
 * layer (which imposes no such constraint at all — an invoice number can be any string there).
 * AIFE's "Dossier de spécifications externes de Chorus Pro — Annexe relative au raccordement EDI",
 * V4.20, rule G1.05 (p.73): "L'identifiant de la facture est limité à 20 caractères alphanumériques.
 * Les caractères spéciaux suivants sont autorisés : espace (" "), tiret ("-"), signe "+", tiret bas
 * (underscore : "_"), barre oblique (slash : "/")." Measured live 2026-09-14
 * (`flux CPP0011117000000000425899`): "Le champ identifiant de la facture
 * (FichierXml.ExchangedDocument.ID.value) ne doit pas depasser 20 caracteres" — exactly the rejection
 * THE INVOICE NUMBER LENGTH GATE below exists to catch before a deposit is even attempted, not hours
 * later from a rejected flux.
 */
const CHORUS_PRO_INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9 +_/-]{1,20}$/;

/**
 * THE PAYMENT MEANS GATE's own STRICT ALLOWLIST (owner's decision, 2026-09-14) — which of this
 * product's payment methods (`payment-methods/built-in.ts`) may appear as BT-81 on a Chorus Pro
 * deposit AT ALL. Deliberately NOT a best-effort UNTDID 4461 mapping: a code merely being ADMITTED by
 * the CII 16B/Factur-X formats (`annexe_edi.txt`, S2.05, p.170: "01 10 20 30 31 42 48 49 58 59 97")
 * is NOT enough on its own to allow it — a public-sector invoice is settled by the buyer's own
 * accountant ("comptable public"), who pays the supplier by bank transfer to its registered bank
 * account; no other payment channel exists in that circuit, so a code the FORMAT admits but the
 * CIRCUIT has no use for is still refused. Two DIFFERENT refusal reasons, tracked separately here
 * because they would not be fixed the same way if the regulation or Chorus Pro's own model changes:
 *
 *  - 'bank_transfer' → ALLOWED, UNTDID 4461 code '30' ("Credit Transfert"/"Virement"). BOTH
 *    conditions hold: S2.05 (p.170) admits it; G1.14 (p.74) states an unset/"autre" payment mode
 *    DEFAULTS to "Virement" in Chorus Pro's own pivot flow; G8.20 (p.91) goes further and HARDCODES
 *    "Mode de règlement" to the literal constant "30" (virement) for the E3 (Mémoire de Frais de
 *    Justice) flow — the only payment mode this annex treats as unconditional anywhere in it.
 *  - 'cheque' → REFUSED, reason "admitted but not established as meaningful in the public payment
 *    circuit". S2.05 (p.170) DOES admit "20 Check"/"Chèque" — the FIRST reason does not apply — but
 *    nothing in this annex states a cheque is ever used to settle a public-sector invoice through
 *    Chorus Pro; not established, so refused rather than guessed.
 *  - 'cash' → REFUSED, the SAME "admitted but not established" reason: S2.05 (p.170) admits "10
 *    Cash"/"Espèce", but the annex never describes cash as a real settlement path for a public
 *    buyer's invoice either.
 *  - 'stripe' → REFUSED, the SAME "admitted but not established" reason: S2.05 (p.170) admits "48
 *    Bank Card", and Stripe genuinely IS a card processor (`payment-methods/stripe.descriptor.ts`'s
 *    own header) — but a public accountant paying a supplier invoice through a private card-payment
 *    gateway has no basis anywhere in this annex either.
 *  - 'paypal' → REFUSED, the OTHER reason — "not admitted by the UNTDID 4461 list at all": no code
 *    in S2.05's own list corresponds to a PayPal-style wallet — a genuine absence, not an
 *    unresearched one.
 *
 * NOT ESTABLISHED: whether 'cheque'/'cash'/'stripe' are refused because French public accounting law
 * (Décret n° 2012-1246 du 7 novembre 2012, "GBCP") forbids them outright, or merely because Chorus
 * Pro's own data model never exercises them for THIS flow — this annex does not say either way, and
 * this comment does not claim it does.
 *
 * A payment method this product adds LATER, with no entry here, is refused the SAME way 'paypal' is —
 * unlisted is never treated as allowed (see the gate below: this is an ALLOWLIST of one id, not a
 * denylist of four).
 */
const CHORUS_PRO_ALLOWED_PAYMENT_METHOD_ID = 'bank_transfer';

/**
 * PISTE base URLs — REPRISED from the reference's own `choruspro-transmission.ts#CHORUS_PRO_URLS`, and
 * the sandbox pair independently RE-VERIFIED reachable on 2026-09-02 (see `choruspro-client.ts`'s own
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
        'channel. See documentation/docs/developer-guide/credentials-guide.md §3 for how to obtain both.',
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

      // THE INVOICE NUMBER LENGTH GATE — see this file's own header and
      // `CHORUS_PRO_INVOICE_NUMBER_PATTERN`'s own comment. Checked FIRST, before any DB round-trip —
      // it needs nothing but the document's own `displayNumber`, already on `ctx`.
      const displayNumber = ctx.document.displayNumber ?? '';
      if (!CHORUS_PRO_INVOICE_NUMBER_PATTERN.test(displayNumber)) {
        throw new BadRequestException(
          `Cannot deposit to Chorus Pro: the invoice number "${displayNumber}" is not valid for a ` +
            'Chorus Pro deposit. Chorus Pro limits the invoice identifier to 20 characters — letters, ' +
            'digits, space, "-", "+", "_" and "/" only. Shorten this company\'s invoice numbering ' +
            'pattern (Company settings → Numbering) before sending to Chorus Pro.',
        );
      }

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

      // THE PAYMENT MEANS GATE — see this file's own header and `CHORUS_PRO_ALLOWED_PAYMENT_METHOD_ID`'s
      // own header for the full STRICT ALLOWLIST reasoning. Derived from this company's own CONFIGURED
      // payment methods, never from `Company.iban` alone.
      const paymentMethods = await listCompanyPaymentMethods(ctx.companyId);
      const enabledPaymentMethods = paymentMethods.filter((method) => method.enabled);
      const bankTransfer = enabledPaymentMethods.find(
        (method) => method.id === CHORUS_PRO_ALLOWED_PAYMENT_METHOD_ID,
      );
      if (!bankTransfer) {
        throw new BadRequestException(
          enabledPaymentMethods.length > 0
            ? 'Cannot deposit to Chorus Pro: this company only accepts payment by ' +
                `${enabledPaymentMethods.map((method) => method.label).join(', ')} for this invoice — ` +
                "a public buyer cannot use that. A public-sector invoice is always paid by the buyer's " +
                "own accountant, by bank transfer to the supplier's bank account; no other payment " +
                'channel exists in that circuit. Enable and configure "Bank transfer" (Company ' +
                'settings → Payment methods) before sending this invoice to Chorus Pro.'
            : 'Cannot deposit to Chorus Pro: this company has no payment method configured. A ' +
                "public-sector invoice is always paid by the buyer's own accountant, by bank transfer " +
                'to the supplier\'s bank account. Enable and configure "Bank transfer" (Company ' +
                'settings → Payment methods) before sending this invoice to Chorus Pro.',
        );
      }
      // Still checked directly on the raw `company` row (the same field
      // `build-semantic-invoice.ts#sellerPaymentMeans` reads, so this gate and that function can never
      // drift on what "has an IBAN on file" means) — NOT redundant with `bankTransfer` above: the
      // general company-settings PATCH (`company.service.ts`) can null `Company.iban` directly,
      // independent of this method's own "enabled" flag, so "bank_transfer" can be enabled with no
      // IBAN actually on file.
      if (!company.iban) {
        throw new BadRequestException(
          'Cannot deposit to Chorus Pro: "Bank transfer" is enabled but this company has no IBAN on ' +
            'file. Chorus Pro requires a payment account (BT-84) on every bank-transfer invoice it ' +
            'accepts — set an IBAN in company settings (Payment methods → Bank transfer) before ' +
            'sending, or Chorus Pro will reject the deposit after the fact.',
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
        // Same gate `pdp-transport.ts` enforces for its own build — an
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
        // THE HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): PISTE
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
        // Legal archiving — the ONLY artifact this transport ever delivers is
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
