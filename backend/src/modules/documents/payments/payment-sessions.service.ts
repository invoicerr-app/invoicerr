import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';

import { fromMinor } from '@/utils/financial';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { DocumentsService } from '../documents.service';
import { PaymentProviderRegistry } from './payment-provider-registry';
import { PaymentWebhookVerificationError } from './provider';
import {
  attachSessionPayment,
  claimSessionForCompletion,
  createCheckoutSession,
  findPendingSessionForDocument,
  listSessionsForDocument,
  markSessionFailed,
  PaymentCheckoutSessionResult,
  releaseSessionClaim,
} from './payment-sessions.persistence';

/** Today's ONE supported provider — see `payment-provider-registry.ts`'s own header on why adding a
 *  second is a registration, never a rewrite of this service. Hardcoded here (rather than a per-company
 *  choice) because exactly one provider ships; the day a second does, this becomes a company setting
 *  the same way `Company.invoiceTransportId` already is for delivery channels. */
const DEFAULT_PROVIDER_ID = 'stripe';

export interface CreateInvoiceCheckoutSessionInput {
  successUrl: string;
  cancelUrl: string;
}

export interface InvoiceCheckoutSessionResult {
  checkoutUrl: string;
}

/**
 * TODO_FEATURES.md rank 1 ("paiement en ligne"). Three decisions this class embodies — spelled out
 * here once rather than re-derived at every call site:
 *
 *  1. PROVIDER SHAPE: a `PaymentProvider` (`provider.ts`) resolved through `PaymentProviderRegistry` —
 *     never `PluginRegistry`, never a hardcoded `if (providerId === 'stripe')` branch. See
 *     `provider.ts`'s own header for the full "narrow-interface-at-the-core" reasoning.
 *  2. CREDENTIAL OWNERSHIP: bring-your-own-account, per company, through the SAME encrypted
 *     `CompanyChannelConfig` storage every national channel already uses
 *     (`ChannelCredentialsService`, `CREDENTIALS_ENCRYPTION_KEY`) — never a single operator-wide Stripe
 *     account shared across companies. A shared-platform-account model (Stripe Connect) was the other
 *     option on the table: it would need this project to itself hold a Stripe platform account (which
 *     does not exist and will not exist for this task — see this feature's own brief), an OAuth
 *     onboarding flow per connected company, and application-fee/transfer bookkeeping this codebase has
 *     nowhere to put. Bring-your-own-account costs a company one more settings screen to fill in and
 *     buys total parity with how PDP/KSeF/SdI/Peppol/Chorus Pro credentials already work — one
 *     mechanism, one encryption key, one settings pattern, for every external integration this app has.
 *  3. WEBHOOK TRUST: `parseWebhookEvent` (delegated to the resolved provider) verifies a cryptographic
 *     signature over the RAW request body against THIS company's own webhook secret before this class
 *     ever looks at the event's contents — see `stripe-signature.ts`'s own header for exactly what that
 *     checks. REPLAY is made inert by `PaymentCheckoutSession.status`'s own atomic
 *     PENDING→COMPLETED claim (`claimSessionForCompletion` — the exact same conditional-write shape
 *     `bank-reconciliation/persistence.ts#claimLineForReconciliation` already uses for the identical "an
 *     external event must credit a document AT MOST ONCE" problem): a second delivery of the SAME event
 *     (Stripe's own documented at-least-once contract) finds the session already COMPLETED and does
 *     nothing — see `handleWebhookEvent`'s own header for the exact ordering.
 *
 * Never writes `DocumentPayment` directly — like `BankReconciliationService.reconcileLine`, every
 * credit runs through `DocumentsService.runAction('invoice', 'record-payment', …)`, the exact SAME
 * action a hand-entered payment and a reconciled bank line both go through. This is what keeps three
 * independent "money arrived" sources (a human, a bank statement, a payment provider) from ever
 * disagreeing about a balance: the currency-conversion guard, the country-policy/status gates, the
 * `DOCUMENT_SETTLED` webhook, and the settlement log line all come from that ONE action, once.
 *
 * `amountMinor` is ALWAYS `settlement/compute-settlement.ts`'s own `outstandingMinor`, read fresh at
 * session-creation time — never anything the browser sends (this feature's own hard rule).
 */
@Injectable()
export class PaymentSessionsService {
  private readonly logger = new Logger(PaymentSessionsService.name);

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly channelCredentials: ChannelCredentialsService,
    private readonly providerRegistry: PaymentProviderRegistry,
  ) {}

  /**
   * Opens (or reuses) a Stripe Checkout session for one invoice's own outstanding balance. Callers —
   * today, only `PortalService.createInvoiceCheckoutSession` — are responsible for their OWN visibility
   * check (`assertVisibleToClient` for the portal) BEFORE calling this: this method still re-checks
   * status and provider connectivity itself (the same "the API refuses exactly what the screen would
   * refuse" discipline `documents.service.ts#runAction` holds throughout), but it has no notion of
   * "which client is asking" at all — that boundary belongs one layer up.
   */
  async createInvoiceCheckoutSession(
    companyId: string,
    documentId: string,
    input: CreateInvoiceCheckoutSessionInput,
  ): Promise<InvoiceCheckoutSessionResult> {
    const document = await this.documentsService.getDocument(companyId, 'invoice', documentId);
    if (document.status !== 'sent') {
      throw new ConflictException(
        `Cannot open a payment session for an invoice with status "${document.status}" — only a ` +
          '"sent" invoice can be paid.',
      );
    }

    const { settlement } = await this.documentsService.getSettlement(companyId, 'invoice', documentId);
    if (settlement.outstandingMinor <= 0) {
      throw new ConflictException('This invoice is already fully settled — there is nothing left to pay.');
    }

    const data = (document.data ?? {}) as Record<string, unknown>;
    const currency = typeof data.currency === 'string' ? data.currency : undefined;
    if (!currency) {
      throw new ConflictException(`Invoice "${documentId}" has no currency recorded.`);
    }

    const provider = this.providerRegistry.resolve(DEFAULT_PROVIDER_ID);
    const config = await this.channelCredentials.resolveActive(companyId, DEFAULT_PROVIDER_ID);
    if (!provider || !config) {
      // Same 501 shape `pdp-transport.ts#requireConnectedPdp` already uses for "no channel connected" —
      // a company has simply never filled in Settings → Payments, never a server-side bug.
      throw new NotImplementedException(
        'Online payment is not connected for this company yet. Connect a payment provider in company ' +
          'settings (Payments) before sharing a Pay link.',
      );
    }

    // Reused ONLY when the amount still matches what a fresh computation would open — an outstanding
    // balance that moved since an earlier click (a partial payment recorded by other means in the
    // meantime) must never hand back a session quoting a now-wrong figure. The stale PENDING session is
    // simply left behind, harmless: at worst it becomes an abandoned link on the provider's own hosted
    // page (Stripe expires an unused checkout session after 24h on its own side).
    const pending = await findPendingSessionForDocument(companyId, documentId, DEFAULT_PROVIDER_ID);
    if (pending && pending.amountMinor === settlement.outstandingMinor && pending.currency === currency) {
      return { checkoutUrl: pending.checkoutUrl };
    }

    const created = await provider.createCheckoutSession(config.config, {
      amountMinor: settlement.outstandingMinor,
      currency,
      description: `Invoice ${document.displayNumber ?? document.id}`,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      // How `handleWebhookEvent` COULD correlate an event back to this exact call without a DB lookup
      // at all — kept for a future provider that echoes metadata verbatim on its webhook, but never
      // TRUSTED for that purpose today: the actual correlation is `providerSessionId`, looked up
      // straight from the persisted row (`findSessionByProviderRef`) — see this class's own header.
      metadata: { companyId, documentId },
    });

    const session = await createCheckoutSession({
      companyId,
      documentId,
      providerId: DEFAULT_PROVIDER_ID,
      providerSessionId: created.providerSessionId,
      amountMinor: settlement.outstandingMinor,
      currency,
      checkoutUrl: created.checkoutUrl,
    });

    return { checkoutUrl: session.checkoutUrl };
  }

  /** Staff-facing read — see `payment-sessions.persistence.ts#listSessionsForDocument`'s own header;
   *  no product screen renders this today, it exists for support/troubleshooting and for this
   *  feature's own e2e spec, which has no other way to learn a session's `providerSessionId` (a real
   *  browser flow never sees it — it only ever sees the redirect). */
  async listSessionsForDocument(
    companyId: string,
    documentId: string,
  ): Promise<PaymentCheckoutSessionResult[]> {
    return listSessionsForDocument(companyId, documentId);
  }

  /**
   * The webhook entry point. `companyId`/`providerId` come from the URL — a ROUTING hint, never
   * something this method trusts on its own (see this class's own header, point 3): the actual
   * authorization is `provider.parseWebhookEvent` throwing `PaymentWebhookVerificationError` for
   * anything that fails signature/timestamp verification against THIS company's own webhook secret.
   * `PaymentsWebhookController` maps that exception to 400; every other path below answers 200 —
   * Stripe (and every other provider) retries a non-2xx delivery for up to three days, which is
   * exactly the recovery mechanism a genuinely failed `record-payment` call needs (see the block below)
   * and exactly what an event this app simply does not care about must NOT trigger (a webhook endpoint
   * that errors on an unrecognized event type teaches the provider to retry forever, then to disable
   * the endpoint).
   *
   * Ordering, and why it matters (mirrors `BankReconciliationService.reconcileLine`'s own header):
   *  1. Resolve the provider + this company's credentials, then verify the signature. Nothing below
   *     this line runs for an event that fails verification.
   *  2. Look up the `PaymentCheckoutSession` this event's own `providerSessionId` names. Not found
   *     means an event this app never opened a session for (a stray/foreign event, or one from before a
   *     database reset) — logged, answered 200, never an error.
   *  3. `claimSessionForCompletion` — the atomic claim. Not won means this event was ALREADY processed
   *     (a replay) or lost a genuine race to a concurrent delivery — either way, a correct no-op.
   *  4. Only once claimed: call "record-payment" through the REAL action, exactly like a hand-entered
   *     payment or a reconciled bank line. `paidAt` is "now" (unlike a bank reconciliation's own line
   *     date, a checkout completion has no earlier "when the money actually arrived" fact to defer to).
   *  5. `attachSessionPayment` records which payment resulted, read straight off
   *     `ActionResult.createdPaymentId` (see that field's own header in `action-registry.ts`). This
   *     USED TO be resolved by diffing `listPayments`/`getSettlement` before/after, the identical
   *     "which row is the NEW one" guess `BankReconciliationService.reconcileLine` used to make and
   *     was found to mis-attribute under interleaved concurrent calls against the same invoice — the
   *     exact same risk applied here (two webhook deliveries for two different sessions on the same
   *     invoice, or a webhook racing a hand-entered/reconciled payment). Reading the id the handler
   *     already has removes the guess entirely, for both callers.
   *  6. If step 4 or 5 THROWS: `releaseSessionClaim` undoes step 3's claim, and this method RETHROWS —
   *     `PaymentsWebhookController` turns that into a 500, so the provider's own retry schedule gets
   *     another attempt. This is the answer to this feature's own hard rule ("a payment that succeeds
   *     at the provider but fails to record here must be recoverable and must not be silently lost"):
   *     the session row itself is the recovery point (never marked COMPLETED without a `paymentId` to
   *     show for it), the provider's own retries are the recovery MECHANISM, and every failure is
   *     logged loudly enough that a stuck PENDING session with a provider-side "paid" status is a
   *     findable, not a silent, failure.
   */
  async handleWebhookEvent(
    companyId: string,
    providerId: string,
    rawBody: Buffer | string,
    signatureHeader: string | undefined,
  ): Promise<{ outcome: 'processed' | 'ignored' | 'unknown_session' }> {
    const provider = this.providerRegistry.resolve(providerId);
    if (!provider) {
      throw new NotFoundException(`No payment provider registered for "${providerId}".`);
    }

    const config = await this.channelCredentials.resolveActive(companyId, providerId);
    if (!config) {
      throw new PaymentWebhookVerificationError(
        `"${providerId}" is not connected for company "${companyId}" — cannot verify this webhook.`,
      );
    }

    // Throws PaymentWebhookVerificationError on anything that fails signature/timestamp verification —
    // nothing below this line ever runs for a forged or stale request.
    const event = provider.parseWebhookEvent(rawBody, signatureHeader, config.config);

    if (event.type === 'checkout.failed' && event.providerSessionId) {
      await markSessionFailed(providerId, event.providerSessionId);
      return { outcome: 'processed' };
    }
    if (event.type !== 'checkout.completed' || !event.providerSessionId) {
      return { outcome: 'ignored' };
    }

    const claimed = await claimSessionForCompletion(providerId, event.providerSessionId);
    if (!claimed) {
      // Either a replay of an event already processed, or a lost race against a concurrent delivery of
      // the SAME event — both mean "nothing left to do", never an error. Also covers a
      // `providerSessionId` this app never opened a session for at all (the conditional UPDATE simply
      // matches zero rows either way) — logged so a genuinely stray event is still findable.
      this.logger.log(
        `Stripe checkout ${event.providerSessionId} already processed (or unknown) — replay/no-op.`,
      );
      return { outcome: 'unknown_session' };
    }

    try {
      const document = await this.documentsService.getDocument(
        claimed.companyId,
        'invoice',
        claimed.documentId,
      );

      const result = await this.documentsService.runAction(claimed.companyId, 'invoice', 'record-payment', {
        documentId: claimed.documentId,
        data: (document.data ?? {}) as Record<string, unknown>,
        params: {
          amount: fromMinor(claimed.amountMinor, claimed.currency),
          currency: claimed.currency,
          paidAt: new Date().toISOString(),
          // 'stripe' — `payment-methods/stripe.descriptor.ts`'s own registered id, now that
          // `record-payment.method` is a strict 'select' over `payment-methods/built-in.ts`'s typed
          // list (invoice.descriptor.ts's own `PAYMENT_METHOD_OPTIONS`) rather than four bare product
          // strings — an invented value would 400 here, never silently pass. Honest regardless of
          // which underlying Stripe Checkout flow the payer actually used (card, SEPA debit, ...): the
          // PROVIDER is what this id names, exactly as "bank_transfer"/"cash" name a channel, not a
          // specific instrument; `note` below carries the actual provider + session id for anyone who
          // needs the detail.
          method: 'stripe',
          note: `Paid via Stripe checkout (${claimed.providerSessionId})`,
        },
      });

      const paymentId = result.createdPaymentId;
      if (!paymentId) {
        // Unreachable in practice — "record-payment" always returns the id of the payment it just
        // inserted on success — but never trusted alone, the same defensive posture
        // `BankReconciliationService.reconcileLine` already holds for the identical "should never
        // happen" case.
        throw new Error('"record-payment" ran but returned no createdPaymentId.');
      }
      await attachSessionPayment(claimed.id, paymentId);
      return { outcome: 'processed' };
    } catch (error) {
      await releaseSessionClaim(providerId, event.providerSessionId);
      this.logger.error(
        `Stripe checkout ${event.providerSessionId} completed at the provider but "record-payment" ` +
          `failed — released back to PENDING for the provider's own retry. ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      throw error;
    }
  }
}
