/**
 * TODO_FEATURES.md rank 19, second pass — the ACCEPTANCE record: "Un écart est accepté par OWNER ou
 * ADMIN, tracé : qui, quand" (product decision, 2026-09-15). ONE acceptance per received invoice, for
 * the WHOLE reconciliation — not per line: the screen offers a single "Accept the variance" button
 * (`document-reconciliation-section.tsx`), so there is exactly one decision to record, the same
 * "one human decision, one record" shape `received-invoice.descriptor.ts`'s own "approve"/"reject"
 * already holds for the received invoice's OWN review.
 *
 * ## Storage — `DocumentInstance.data.varianceAcceptance`, a RESERVED key, not a declared field
 *
 * The exact same convention `received-invoice.descriptor.ts`'s own header documents for
 * `fileRef`/`fileName`/`fileMime`/`lineTotalWarnings`: a fact this company's own SYSTEM writes (never
 * something a human types into the generic field-kind form), carried in the SAME `data` JSON every
 * other field already uses — no migration, `validateAgainstDescriptor` never touches it because it is
 * not one of the type's declared `fields`. Written through the SAME tenant-scoped `upsertDocument`
 * (persistence.ts) every other write to this type already goes through, never a second, ad-hoc Prisma
 * path — keeping the CURRENT status untouched (an acceptance is not a lifecycle transition; a received
 * invoice's own "approved"/"rejected"/"received" status is an orthogonal fact this never overwrites).
 */
import { findOwnedDocument, upsertDocument } from '../persistence';
import { DocumentInstanceResult } from '../actions/action-registry';

export interface VarianceAcceptance {
  acceptedByUserId: string;
  /** A human-facing snapshot of who accepted — captured AT acceptance time (never re-resolved later
   *  against the user's current name/email, the same "frozen at the moment of the fact" posture
   *  `DocumentInstance.displayNumber` already holds for a number): a member later renamed, or removed
   *  from the company, must not silently rewrite what this trail says. */
  acceptedByLabel: string;
  /** ISO 8601 — captured server-side, never trusted from the caller. */
  acceptedAt: string;
  /** Optional free-text motive — never required: the product decision names "qui, quand", a reason is
   *  a bonus, not a gate. */
  reason?: string;
}

/** Pure read off already-fetched `data` — never re-fetches. `null` covers both "never accepted" and
 *  "the stored shape is not a valid acceptance" (a future format change, a corrupted write) — the same
 *  "degrade honestly, never throw on a read" rule this core already holds for a descriptor/data
 *  mismatch elsewhere. */
export function getVarianceAcceptance(data: Record<string, unknown>): VarianceAcceptance | null {
  const raw = data.varianceAcceptance;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.acceptedByUserId !== 'string' || !candidate.acceptedByUserId) return null;
  if (typeof candidate.acceptedByLabel !== 'string' || !candidate.acceptedByLabel) return null;
  if (typeof candidate.acceptedAt !== 'string' || !candidate.acceptedAt) return null;
  return {
    acceptedByUserId: candidate.acceptedByUserId,
    acceptedByLabel: candidate.acceptedByLabel,
    acceptedAt: candidate.acceptedAt,
    ...(typeof candidate.reason === 'string' && candidate.reason.trim() ? { reason: candidate.reason } : {}),
  };
}

/**
 * Records the acceptance on this received invoice — tenant-scoped (`findOwnedDocument` 404s for a
 * document that doesn't exist or isn't this company's own, before anything is written), and IDEMPOTENT
 * in the sense that a second call simply overwrites the first with a fresh `acceptedAt`/`acceptedBy` —
 * there is no "already accepted" refusal here: role-gating (OWNER/ADMIN only — see this file's own
 * header) already lives at the controller (`@Roles`), and a later, different OWNER/ADMIN re-confirming
 * the same variance is a legitimate re-statement of the same decision, not an error.
 */
export async function acceptVariance(
  companyId: string,
  receivedInvoiceId: string,
  acceptedByUserId: string,
  acceptedByLabel: string,
  reason?: string,
): Promise<DocumentInstanceResult> {
  const existing = await findOwnedDocument(companyId, 'received-invoice', receivedInvoiceId);
  const data = (existing.data ?? {}) as Record<string, unknown>;

  const acceptance: VarianceAcceptance = {
    acceptedByUserId,
    acceptedByLabel,
    acceptedAt: new Date().toISOString(),
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
  };

  return upsertDocument(companyId, 'received-invoice', receivedInvoiceId, existing.status, {
    ...data,
    varianceAcceptance: acceptance,
  });
}
