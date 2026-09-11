import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

/**
 * Internal approval workflow ("workflow d'approbation interne au-delà d'un seuil") — the QUICK-WIN
 * scope: a ROLE+VALUE GATE on the "send" action, wired into `documents.service.ts#runAction`. NOT a
 * full request→approve state machine — there is no pending-approval record, no separate "approve"
 * action, and no notification to an approver. A higher role (ADMIN/OWNER) sending the document past
 * the threshold itself IS the approval. Should the product ever need an actual queue (a MEMBER
 * submits, an ADMIN later approves the SAME attempt asynchronously), that is a materially bigger
 * feature — a new persisted state (e.g. a `pending` document status or a dedicated approval table),
 * a notification path, and a second endpoint for the approver to act on — deliberately left as a
 * future extension, not built here.
 *
 * `requiresApproval` is kept pure (no I/O) so it is trivially unit-testable without mocking Prisma —
 * `resolveApprovalThresholdMinor` below is the one bit of I/O the caller needs, kept separate for the
 * same reason.
 */

/** The exact refusal `runAction` throws (`ForbiddenException`) when this gate fires — named once here
 *  so the unit tests and the wiring site can't drift apart on wording. */
export const APPROVAL_REQUIRED_MESSAGE =
  "Sending this document requires approval from an ADMIN or OWNER: its total exceeds the company's approval threshold.";

/**
 * Whether a "send" attempt at the given gross total needs an ADMIN/OWNER instead of the caller who
 * made it.
 *
 * - `thresholdMinor` NULL/undefined → false, always. `Company.approvalThresholdMinor`'s own default;
 *   a company that never configured a threshold gates nothing, for any role, at any amount.
 * - `role` undefined → false, always. `runAction`'s `role` parameter is itself optional (see its own
 *   header) precisely so a caller that never carries an HTTP role — the worker replaying an
 *   already-approved async send, or any other internal/non-HTTP caller — is NEVER re-gated. Re-gating
 *   an async retry would be actively wrong: the human approval (if any was needed) already happened
 *   when the record first left "draft", and the retry must still be able to deliver it.
 * - `role !== 'MEMBER'` (OWNER, ADMIN, or the synthetic ADMIN role AuthGuard grants API-key auth) →
 *   false. OWNER/ADMIN sending a document past the threshold themselves IS the approval this feature
 *   asks for — there is no separate approver to route to.
 * - Otherwise (a MEMBER, a real threshold) → `grossMinor > thresholdMinor`. Strictly greater, not
 *   greater-or-equal: a document exactly AT the configured limit is the boundary a company chose to
 *   allow, not the first amount it wants to block.
 */
export function requiresApproval(
  role: CompanyRole | undefined,
  grossMinor: number,
  thresholdMinor: number | null | undefined,
): boolean {
  if (thresholdMinor == null) return false;
  if (role === undefined || role !== 'MEMBER') return false;
  return grossMinor > thresholdMinor;
}

/**
 * The company's configured approval threshold, in MINOR units — `null` (not configured) is the
 * overwhelmingly common case and is a normal, expected result, not a missing-company condition.
 *
 * CROSS-CURRENCY CAVEAT: this value is compared directly (in `requiresApproval`) against a document's
 * OWN `grossMinor`, in that document's OWN currency — it is a rough guardrail, not a currency-converted
 * limit. A company invoicing in several currencies gets the SAME numeric ceiling applied to each of
 * them regardless of currency; deliberately not solved here (see this module's own header on scope).
 */
export async function resolveApprovalThresholdMinor(companyId: string): Promise<number | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { approvalThresholdMinor: true },
  });
  return company?.approvalThresholdMinor ?? null;
}
