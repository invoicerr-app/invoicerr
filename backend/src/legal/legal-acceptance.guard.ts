/**
 * `requiresAcceptance`/`pending` (`legal.service.ts#getStatus`) used to be purely INFORMATIONAL: no
 * guard anywhere actually refused a request once a document's content changed and the caller had not
 * re-accepted it. The frontend's own sign-in interstitial (`pages/legal/accept.tsx`) is a courtesy, not
 * a boundary — closing it, calling the API directly, or driving it through an API key all kept working
 * regardless, which defeats the entire purpose of a mechanism whose only reason to exist is proof of
 * consent.
 *
 * Registered as a global `APP_GUARD` in `app.module.ts`, ONLY when `isBillingEnabled()` — the exact
 * same `...(billingEnabled ? [...] : [])` conditional `CompanyWriteGuard` is registered with, and for
 * the same reason: self-hosted has nothing to accept in the first place
 * (`legal-signup-policy.ts`'s own header), so this guard's absence there is structural, not a
 * runtime no-op. Runs alongside `AuthGuard`/`RolesGuard`/`ThrottlerGuard`/`CompanyWriteGuard` — Nest
 * ANDs every registered `APP_GUARD` (`app.module.ts`'s own comment on `ThrottlerGuard` describes the
 * relationship), so this only ever ADDS a check.
 *
 * ## A write gate, never a lockout
 *
 * This guard withholds WRITES, never access to what the caller can already read: a user who has not
 * accepted a changed document keeps every read they had (READ_ONLY_METHODS below), can still pull a
 * full copy of their own data, and can still end the relationship — reading your own accounting
 * records and leaving are not things a contract you have not agreed to should be able to hold hostage.
 * Concretely, on top of the blanket read exemption:
 *  - `CompaniesController#exportData` (`POST /companies/export`) — the product's own self-service data
 *    export; a POST at the transport level, but the one write it performs (a per-company export
 *    cooldown timestamp) is incidental to what the route fundamentally does, which is hand the caller
 *    a copy of data they can already read;
 *  - `CompaniesController#leave` (`DELETE /companies/leave`) — a member's own way to end their
 *    relationship with a company whose terms they will not accept;
 *  - `DangerController#requestOtp`/`#deleteCompany` (`POST /danger/otp`, `POST /danger/delete-company`)
 *    — an OWNER's equivalent termination path, deleting the company outright. `resetCompanyData`
 *    carries NO exemption of its own: it is destructive, but the relationship continues afterwards, so
 *    it is gated like any other write (see its own comment in `danger.controller.ts`);
 *  - `BillingController#openPortal`/`#openLegacyPortal` (`POST /billing/portal[/legacy]`) — the Polar
 *    customer-portal session that IS this product's own "cancel at any time" flow. `startCheckout`
 *    carries no exemption: starting or renewing a paid subscription grows the relationship rather than
 *    ending it.
 *
 * Every one of those still changes some row somewhere — the line drawn here is not "no side effect
 * at all", it is "does not grow what the account holds or how long it holds it" (export, leaving,
 * deleting, cancelling) versus "creates, edits, sends, or otherwise commits the account to more of the
 * product" (a new company, a new document, a new subscription, a company-data reset that leaves the
 * subscription running) — only the latter waits on acceptance.
 *
 * Exemptions, deliberately narrow:
 *  - read-only methods (GET/HEAD/OPTIONS) — a pending acceptance blocks doing things with the
 *    product, never looking at it (including the interstitial's own `GET /legal/status` read);
 *  - no authenticated user on the request at all (`request.user`) — `/api/auth/*` never reaches this
 *    guard regardless (mounted as raw middleware ahead of Nest's router entirely, the same reason
 *    `ThrottlerGuard` misses it, see `lib/auth-rate-limit.ts`'s own header) — which also means
 *    better-auth's own self-service account deletion is reachable regardless of a pending legal
 *    re-acceptance, for free, and every `/api/portal/*` client-portal route is `@Public()` from
 *    `AuthGuard`'s own point of view — its bearer-token identity is never written to `request.user`
 *    (see `portal-auth.guard.ts`'s own header) — so this check is what naturally leaves the public
 *    portal untouched, with no route-by-route exemption needed;
 *  - `@LegalGateExempt()` — `POST /legal/accept` (the one write that must stay reachable to ever CLEAR
 *    the pending state this guard enforces) plus the read/export/termination routes listed above.
 *
 * Deliberately covers an API-key-authenticated request the identical way it covers a session one
 * (`AuthGuard` sets `request.user` for both) — the exact gap the "quiconque... utilise une clé d'API"
 * finding named: automation must not be a way to keep using the product while a required re-acceptance
 * sits unanswered.
 *
 * ## One more exemption: a paid subscription period already in progress (Terms of Service Section 20.2)
 *
 * A Company that has already paid for a subscription period keeps FULL write access — under the
 * version of the Terms in force when it paid — for the rest of that period, even with a pending
 * `terms-of-service` re-acceptance: a unilateral later change cannot retroactively shorten what was
 * already bought. `filterPendingSlugsAfterPaidPeriodGrace` (`terms-paid-period-exemption.ts`) computes
 * this from the Company's own `CompanySubscription` row and the document's real release timestamp; see
 * that file's own header for exactly which statuses qualify (`ACTIVE` only — `BLOCKED`/`ZIPPED`/
 * `PAST_DUE`/`TRIAL` never do, which is also what keeps a Company already suspended for non-payment
 * from regaining writes through this exact door) and why it is scoped to `terms-of-service` alone, never
 * `privacy-policy` or any future required document.
 */
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RequestWithUser } from '@/types/request';
import { LEGAL_ACCEPTANCE_REQUIRED_CODE } from '@/lib/legal-signup-policy';

import { getPendingAcceptanceSlugs } from './legal-acceptance';
import { getLegalDocument } from './legal-documents';
import { LEGAL_GATE_EXEMPT_KEY } from './legal-gate-exempt.decorator';
import { filterPendingSlugsAfterPaidPeriodGrace } from './terms-paid-period-exemption';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export { LEGAL_ACCEPTANCE_REQUIRED_CODE };

@Injectable()
export class LegalAcceptanceGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest() as RequestWithUser;

    if (READ_ONLY_METHODS.has(request.method)) return true;
    if (!request.user?.id) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(LEGAL_GATE_EXEMPT_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const pending = await getPendingAcceptanceSlugs(request.user.id);
    if (pending.length === 0) return true;

    // Terms of Service Section 20.2: a Company with a subscription period already in progress keeps
    // full write access, under the version it paid for, until that period's own protection lapses —
    // see `terms-paid-period-exemption.ts`'s own header for exactly which slug this ever excuses (only
    // `terms-of-service`) and why. `blocking` is `pending` with that one slug removed when the
    // exception applies — every OTHER pending document (today, only `privacy-policy`) still blocks
    // regardless, deliberately: this reasoning is not extended to documents it does not concern.
    const blocking = await filterPendingSlugsAfterPaidPeriodGrace(pending, request.companyId);
    if (blocking.length === 0) return true;

    // Names what is blocked (this one write, not the account), why (the actual document titles, not
    // their slugs), and what still works — the refusal has to stand on its own for a product people
    // rely on for their accounting, not merely carry a machine-readable `code` the frontend turns
    // into a toast. See this file's own header for the exact read/export/termination routes
    // `readOnly: true` refers to.
    const documentList = blocking.map((slug) => getLegalDocument(slug)?.title ?? slug).join(' and ');
    throw new ForbiddenException({
      message:
        `You must accept our updated ${documentList} before making further changes. You can still ` +
        'view and export all of your data, and close your account or leave this company, without ' +
        'accepting — only actions that create or change data are on hold.',
      code: LEGAL_ACCEPTANCE_REQUIRED_CODE,
      pending: blocking,
      readOnly: true,
    });
  }
}
