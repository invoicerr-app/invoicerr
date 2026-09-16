import { Injectable } from '@nestjs/common';

import { isBillingEnabled } from '../modules/billing/billing-flag';
import { AcceptanceMeta, getPendingAcceptanceSlugs, recordLegalAcceptance } from './legal-acceptance';
import { LegalDocument, REQUIRED_ACCEPTANCE_SLUGS, listLegalDocuments } from './legal-documents';

export interface LegalDocumentsView {
  /** Mirrors `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` — the frontend's own signal for whether the
   *  sign-up screen must show the acceptance checkbox at all (no separate, Vite-side env var mirrors
   *  the server-side flag, the same reasoning `use-billing.ts`'s own header gives for
   *  `GET /api/billing/status`). */
  saasMode: boolean;
  documents: LegalDocument[];
}

export interface LegalStatusView {
  requiresAcceptance: boolean;
  pending: string[];
}

@Injectable()
export class LegalService {
  listDocuments(): LegalDocumentsView {
    return { saasMode: isBillingEnabled(), documents: listLegalDocuments() };
  }

  /** Always the empty/false shape outside SaaS mode — see `getPendingAcceptanceSlugs`'s own header
   *  for why a self-hosted user, who never has a `LegalAcceptance` row at all, must not be told
   *  every document is "pending" with no screen that could ever clear it. */
  async getStatus(userId: string): Promise<LegalStatusView> {
    if (!isBillingEnabled()) return { requiresAcceptance: false, pending: [] };
    const pending = await getPendingAcceptanceSlugs(userId);
    return { requiresAcceptance: pending.length > 0, pending };
  }

  /**
   * Records acceptance of `slugs`, or — when omitted/empty — of whatever is currently pending (the
   * sign-in re-acceptance interstitial's own call, which doesn't need to know the exact slug list).
   * An explicit list is filtered down to `REQUIRED_ACCEPTANCE_SLUGS`: this endpoint only ever tracks
   * the two documents the product actually gates on, never an arbitrary slug a caller could pass.
   * A no-op outside SaaS mode, for the same reason `getStatus` short-circuits.
   */
  async accept(
    userId: string,
    slugs: string[] | undefined,
    meta: AcceptanceMeta,
  ): Promise<{ accepted: string[] }> {
    if (!isBillingEnabled()) return { accepted: [] };

    const known = new Set<string>(REQUIRED_ACCEPTANCE_SLUGS);
    const targets =
      slugs && slugs.length > 0
        ? slugs.filter((slug) => known.has(slug))
        : await getPendingAcceptanceSlugs(userId);

    if (targets.length > 0) {
      await recordLegalAcceptance(userId, targets, meta);
    }
    return { accepted: targets };
  }
}
