import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { PaymentCheckoutSessionStatus } from '../../../../prisma/generated/prisma/client';

/**
 * Tenant-safe Prisma persistence for `PaymentCheckoutSession` — every query scoped by `companyId`
 * except the two the webhook itself needs (`findSessionByProviderRef`/`claimSessionForCompletion`),
 * which are scoped by `(providerId, providerSessionId)` instead: an inbound webhook carries no
 * `companyId` a browser could be trusted to send, only the provider's own session id (see
 * `payment-sessions.service.ts`'s own header on why the URL's `:companyId` segment is a routing hint,
 * never the thing that actually authorizes the call — the signature check is). Plain functions, not a
 * class — the same "no DI needed for a pure read/write" shape `bank-reconciliation/persistence.ts`
 * already holds throughout, and for the same reason: `PaymentSessionsService` is the one thing here
 * that needs a provider (`DocumentsService`) injected.
 */

export interface PaymentCheckoutSessionResult {
  id: string;
  companyId: string;
  documentId: string;
  providerId: string;
  providerSessionId: string;
  status: PaymentCheckoutSessionStatus;
  amountMinor: number;
  currency: string;
  checkoutUrl: string;
  paymentId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export async function createCheckoutSession(input: {
  companyId: string;
  documentId: string;
  providerId: string;
  providerSessionId: string;
  amountMinor: number;
  currency: string;
  checkoutUrl: string;
}): Promise<PaymentCheckoutSessionResult> {
  return prisma.paymentCheckoutSession.create({ data: input });
}

/** The most recent still-PENDING session for this (company, document, provider) — reused rather than
 *  opening a second one when a client clicks "Pay" again before finishing (or abandoning) the first,
 *  so a re-click hands back the SAME provider link instead of orphaning one session per click. Ignores
 *  a session's own age: Stripe checkout sessions do expire (24h) on the provider's own side, but
 *  detecting that here would need a round trip to Stripe just to answer "is this still good" — a
 *  stale link simply fails on the provider's own hosted page, and the client comes back for a fresh
 *  one, the same recovery path a genuinely abandoned session already needs. */
export async function findPendingSessionForDocument(
  companyId: string,
  documentId: string,
  providerId: string,
): Promise<PaymentCheckoutSessionResult | null> {
  return prisma.paymentCheckoutSession.findFirst({
    where: { companyId, documentId, providerId, status: PaymentCheckoutSessionStatus.PENDING },
    orderBy: { createdAt: 'desc' },
  });
}

/** Every session opened for one document — company-scoped, most recent first. Backs the staff-facing
 *  `GET .../payment-sessions` read (`payments.controller.ts`) a support conversation or an e2e
 *  assertion uses to find WHICH session id a simulated webhook should reference — nothing in the
 *  product flow itself needs this, `record-payment`'s own result is what a screen actually renders. */
export async function listSessionsForDocument(
  companyId: string,
  documentId: string,
): Promise<PaymentCheckoutSessionResult[]> {
  return prisma.paymentCheckoutSession.findMany({
    where: { companyId, documentId },
    orderBy: { createdAt: 'desc' },
  });
}

/** Looked up by the PROVIDER's own session id — see this file's own header on why a webhook is never
 *  trusted to also name the right `companyId` on its own say-so; `providerId` alone would not be
 *  enough either (Stripe's own session ids are unique to Stripe, but a SECOND provider could — in
 *  theory — reuse the same literal string; this keeps the lookup exact regardless). Returns `null` for
 *  an event this app never opened a session for (a stray/foreign event, a session from a different
 *  environment) — the caller treats that as a no-op, never an error (`payment-sessions.service.ts`). */
export async function findSessionByProviderRef(
  providerId: string,
  providerSessionId: string,
): Promise<PaymentCheckoutSessionResult | null> {
  return prisma.paymentCheckoutSession.findUnique({
    where: { providerId_providerSessionId: { providerId, providerSessionId } },
  });
}

/** 404s (rather than returning null) for a session id that doesn't exist or belongs to another company
 *  — the same "existence and ownership are indistinguishable from outside" convention
 *  `persistence.ts#findOwnedDocument` already holds. Not used by the webhook path (which has no
 *  company-authenticated caller to scope by — see `findSessionByProviderRef` above); only by the
 *  staff-facing read. */
export async function findOwnedSession(
  companyId: string,
  sessionId: string,
): Promise<PaymentCheckoutSessionResult> {
  const session = await prisma.paymentCheckoutSession.findFirst({ where: { id: sessionId, companyId } });
  if (!session) {
    throw new NotFoundException(`Payment checkout session "${sessionId}" not found.`);
  }
  return session;
}

/**
 * The atomic "at most once" guard: an `UPDATE ... WHERE providerId = ? AND providerSessionId = ? AND
 * status = 'PENDING'`, the exact same conditional-write shape
 * `bank-reconciliation/persistence.ts#claimLineForReconciliation` already uses for the identical "two
 * concurrent writers racing over the SAME row can never both win" problem — here, TWO deliveries of
 * the SAME webhook event (Stripe's own at-least-once contract) racing to credit the SAME session.
 * Postgres serializes the two `UPDATE`s; the loser's own `WHERE` clause matches zero rows once the
 * winner commits. Returns whether THIS call won (`count === 1`) — `payment-sessions.service.ts` calls
 * this BEFORE ever calling `record-payment`, so a lost race (a replay, or a genuine double-delivery)
 * never runs it twice.
 */
export async function claimSessionForCompletion(
  providerId: string,
  providerSessionId: string,
): Promise<PaymentCheckoutSessionResult | null> {
  const result = await prisma.paymentCheckoutSession.updateMany({
    where: { providerId, providerSessionId, status: PaymentCheckoutSessionStatus.PENDING },
    data: { status: PaymentCheckoutSessionStatus.COMPLETED, completedAt: new Date() },
  });
  if (result.count !== 1) return null;
  return findSessionByProviderRef(providerId, providerSessionId);
}

/** The SECOND half of a successful completion — records WHICH `DocumentPayment` the claim above
 *  actually produced, once `DocumentsService.runAction` has returned successfully. Split from the claim
 *  itself for the identical reason `bank-reconciliation.service.ts#reconcileLine`'s own
 *  `attachReconciledPayment` is: the payment does not exist yet at claim time. */
export async function attachSessionPayment(sessionId: string, paymentId: string): Promise<void> {
  await prisma.paymentCheckoutSession.update({ where: { id: sessionId }, data: { paymentId } });
}

/**
 * The COMPENSATING rollback for a claim whose `record-payment` call then failed (a country-policy
 * refusal, an unresolvable exchange rate, an invoice that moved out of "sent" in the meantime…) —
 * releases the session back to PENDING so the NEXT delivery of the same webhook event (Stripe retries
 * a non-2xx response for up to three days) gets a genuine second attempt, rather than finding the
 * session already (wrongly) COMPLETED with no payment to show for it. Guarded by `paymentId: null` so
 * this can never undo an ALREADY-COMPLETED session (one whose `attachSessionPayment` call already
 * landed) — the same guard `bank-reconciliation/persistence.ts#releaseLineClaim` already holds via
 * `reconciledPaymentId: null`. See `payment-sessions.service.ts#handleWebhookEvent`'s own header for
 * what this means for a payment that succeeded at Stripe but failed to record here.
 */
export async function releaseSessionClaim(providerId: string, providerSessionId: string): Promise<void> {
  await prisma.paymentCheckoutSession.updateMany({
    where: { providerId, providerSessionId, status: PaymentCheckoutSessionStatus.COMPLETED, paymentId: null },
    data: { status: PaymentCheckoutSessionStatus.PENDING, completedAt: null },
  });
}

/** A provider-reported failure (an expired session, a declined card) — same conditional shape as the
 *  claim above, so a stray FAILED event arriving after this session was already independently
 *  COMPLETED can never downgrade it. */
export async function markSessionFailed(providerId: string, providerSessionId: string): Promise<void> {
  await prisma.paymentCheckoutSession.updateMany({
    where: { providerId, providerSessionId, status: PaymentCheckoutSessionStatus.PENDING },
    data: { status: PaymentCheckoutSessionStatus.FAILED },
  });
}
