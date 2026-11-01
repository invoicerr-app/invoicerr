import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { PaymentCheckoutSessionStatus } from '../../../../prisma/generated/prisma/client';

/**
 * Tenant-safe Prisma persistence for `PaymentCheckoutSession` — EVERY query is scoped by `companyId`,
 * including the webhook path (`findSessionByProviderRef`/`claimSessionForCompletion`/
 * `releaseSessionClaim`/`markSessionFailed`). The webhook still correlates on
 * `(providerId, providerSessionId)` because an inbound event names no company, but the URL's
 * `:companyId` segment — whose OWN webhook secret is what verified the signature — is carried into
 * every WHERE clause alongside it. Scoping only by the provider's session id was a cross-tenant
 * settlement hole: any company that knows its own webhook secret could name another company's
 * `cs_...` id (not secret — it appears in the payer's own checkout URL) and settle, or fail, that
 * other tenant's invoice. See `payment-sessions.service.ts`'s own header, point 3. Plain functions,
 * not a class — the same "no DI needed for a pure read/write" shape
 * `bank-reconciliation/persistence.ts` already holds throughout, and for the same reason:
 * `PaymentSessionsService` is the one thing here that needs a provider (`DocumentsService`) injected.
 */

/** This company's own chosen payment provider (`Company.paymentProviderId` — see that column's own
 *  schema.prisma comment), read here rather than inline in `PaymentSessionsService` for the SAME
 *  reason every other Prisma access in this file is: `payment-sessions.service.spec.ts` mocks this
 *  WHOLE module (`jest.mock('./payment-sessions.persistence')`), so `PaymentSessionsService` itself
 *  never touches the real Prisma client, even indirectly, in an offline unit test. Returns `null` for
 *  "never explicitly chosen" — `PaymentSessionsService` is the one that decides what that falls back
 *  to (`DEFAULT_PROVIDER_ID`), never this function. */
export async function resolveCompanyPaymentProviderId(companyId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { paymentProviderId: true },
  });
  return company?.paymentProviderId ?? null;
}

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

/** Looked up by the PROVIDER's own session id, always WITH the company whose credentials verified the
 *  webhook — `providerId` alone would not be enough either (Stripe's own session ids are unique to
 *  Stripe, but a SECOND provider could — in theory — reuse the same literal string; this keeps the
 *  lookup exact regardless). `companyId` is not optional: two tenants of this app genuinely can hold
 *  rows that only the company column tells apart once a forged event names someone else's id. Returns
 *  `null` for an event this app never opened a session for FOR THIS COMPANY (a stray/foreign event, a
 *  session from a different environment, or another tenant's session id) — the caller treats that as a
 *  no-op, never an error (`payment-sessions.service.ts`). */
export async function findSessionByProviderRef(
  companyId: string,
  providerId: string,
  providerSessionId: string,
): Promise<PaymentCheckoutSessionResult | null> {
  return prisma.paymentCheckoutSession.findUnique({
    where: {
      companyId,
      providerId_providerSessionId: { providerId, providerSessionId },
    },
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
 * The atomic "at most once" guard: an `UPDATE ... WHERE companyId = ? AND providerId = ?
 * AND providerSessionId = ? AND status = 'PENDING'`, the exact same conditional-write shape
 * `bank-reconciliation/persistence.ts#claimLineForReconciliation` already uses for the identical "two
 * concurrent writers racing over the SAME row can never both win" problem — here, TWO deliveries of
 * the SAME webhook event (Stripe's own at-least-once contract) racing to credit the SAME session.
 * `companyId` is part of the WHERE, never a post-hoc comparison: that is what makes an event signed
 * with company A's secret but naming company B's session match ZERO rows, instead of claiming B's row
 * and settling B's invoice with money A never received. Postgres serializes the two `UPDATE`s; the
 * loser's own `WHERE` clause matches zero rows once the winner commits. Returns whether THIS call won
 * (`count === 1`) — `payment-sessions.service.ts` calls this BEFORE ever calling `record-payment`, so a
 * lost race (a replay, a genuine double-delivery, or a foreign tenant's event) never runs it twice.
 */
export async function claimSessionForCompletion(
  companyId: string,
  providerId: string,
  providerSessionId: string,
): Promise<PaymentCheckoutSessionResult | null> {
  const result = await prisma.paymentCheckoutSession.updateMany({
    where: {
      companyId,
      providerId,
      providerSessionId,
      status: PaymentCheckoutSessionStatus.PENDING,
    },
    data: { status: PaymentCheckoutSessionStatus.COMPLETED, completedAt: new Date() },
  });
  if (result.count !== 1) return null;
  return findSessionByProviderRef(companyId, providerId, providerSessionId);
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
export async function releaseSessionClaim(
  companyId: string,
  providerId: string,
  providerSessionId: string,
): Promise<void> {
  await prisma.paymentCheckoutSession.updateMany({
    where: {
      companyId,
      providerId,
      providerSessionId,
      status: PaymentCheckoutSessionStatus.COMPLETED,
      paymentId: null,
    },
    data: { status: PaymentCheckoutSessionStatus.PENDING, completedAt: null },
  });
}

/** A provider-reported failure (an expired session, a declined card) — same conditional shape as the
 *  claim above, company included, so a forged FAILED event signed with another tenant's secret cannot
 *  move THIS tenant's PENDING session to FAILED (which would make the real `completed` event find no
 *  PENDING row and silently drop a real payment), and a stray FAILED event arriving after this session
 *  was already independently COMPLETED can never downgrade it. */
export async function markSessionFailed(
  companyId: string,
  providerId: string,
  providerSessionId: string,
): Promise<void> {
  await prisma.paymentCheckoutSession.updateMany({
    where: {
      companyId,
      providerId,
      providerSessionId,
      status: PaymentCheckoutSessionStatus.PENDING,
    },
    data: { status: PaymentCheckoutSessionStatus.FAILED },
  });
}
