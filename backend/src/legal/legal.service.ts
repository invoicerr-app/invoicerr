import { Injectable } from '@nestjs/common';

import { isBillingEnabled } from '../modules/billing/billing-flag';
import { AcceptanceMeta, getPendingAcceptanceSlugs, recordLegalAcceptance } from './legal-acceptance';
import { LegalDocumentView, resolveLegalDocumentView } from './legal-document-view';
import { REQUIRED_ACCEPTANCE_SLUGS, listLegalDocuments } from './legal-documents';
import { DEFAULT_LEGAL_DOCUMENT_LANGUAGE } from './legal-languages';

export interface LegalDocumentsView {
  /** Mirrors `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` — the frontend's own signal for whether the
   *  sign-up screen must show the acceptance checkbox at all (no separate, Vite-side env var mirrors
   *  the server-side flag, the same reasoning `use-billing.ts`'s own header gives for
   *  `GET /api/billing/status`). */
  saasMode: boolean;
  documents: LegalDocumentView[];
}

export interface LegalStatusView {
  requiresAcceptance: boolean;
  pending: string[];
}

@Injectable()
export class LegalService {
  /**
   * `preferredLanguages` — built by `legal-request-language.ts` from the caller's `?lang=`, account
   * locale, and `Accept-Language` header, in that priority order — is resolved PER DOCUMENT
   * (`resolveLegalDocumentView`): two documents can, and often do, come back in different languages
   * for the same caller (a French-preferring visitor gets `terms-of-service` in French but
   * `legal-notice` in English, since only the former ships a French translation today). Defaults to
   * `['en']` so every existing caller that has no notion of a preferred language (this service's own
   * spec, anything else that reads it as a plain function) keeps getting exactly the English text it
   * always did.
   */
  /**
   * Outside SaaS mode this returns NO documents at all (decision 2026-09-20). All six ship their own
   * "does not apply to the self-hosted software" scope clause — they describe the author's hosted
   * business (his identity for the legal notice, a subscription that instance doesn't have, a
   * processor relationship where he processes nothing, sub-processors that instance never talks to) —
   * so serving them to a self-hosted operator's own users was never a lighter version of the truth,
   * it was someone else's facts under a caller who has none of them. The self-hoster's own
   * legal-notice obligation, if their jurisdiction has one, is theirs to fulfil under their own name;
   * the one document that genuinely governs a self-hosted install is the licence already in the
   * repository, which this endpoint has never served and still doesn't. `listLegalDocuments()` itself
   * stays ungated — `legal-release-boot.service.ts` reads it directly, self-hosted included, to keep
   * an append-only history of the text this instance ships (see that file's own header); that
   * internal bookkeeping was never what got exposed to an end user and isn't part of this defect.
   */
  listDocuments(
    preferredLanguages: readonly string[] = [DEFAULT_LEGAL_DOCUMENT_LANGUAGE],
  ): LegalDocumentsView {
    const saasMode = isBillingEnabled();
    return {
      saasMode,
      documents: saasMode
        ? listLegalDocuments().map((doc) => resolveLegalDocumentView(doc, preferredLanguages))
        : [],
    };
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
