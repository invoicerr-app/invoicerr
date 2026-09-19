import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { findPortalTokenByHash, touchPortalTokenLastUsed } from './portal-token.persistence';
import { hashPortalToken } from './portal-token';

/**
 * A client portal session is a THIRD, deliberately separate credential kind — neither the better-auth
 * session cookie `AuthGuard` (`guards/auth.guard.ts`) reads, nor that same guard's own API-key bearer
 * fallback (a company-scoped, ADMIN-equivalent credential meant for integrations, never for an
 * end-client's browser). Every `/api/portal/*` route is therefore `@Public()` from the GLOBAL
 * `AuthGuard`'s point of view (no better-auth session, no API key — it would otherwise 401 before this
 * guard ever runs) and protected INSTEAD by this class, applied with `@UseGuards(PortalAuthGuard)` at
 * `PortalController`'s own class level. Nest ANDs every guard that applies to a route (global ones
 * first, then class/method-level ones — see `app.module.ts`'s own comment on why a THIRD global
 * `APP_GUARD` only ADDS a check), so `@Public()` here means "skip the STAFF check", never "skip every
 * check".
 *
 * ## Why a bearer header, never a cookie
 *
 * Every OTHER session in this app is a same-site-ish cookie (`credentials: "include"`,
 * `authenticatedFetch`) — reusing that shape here would mean minting a SECOND, differently-named
 * cookie, correctly scoped (path, SameSite, Secure) across three environments (dev :5173→:3000, test
 * :6284→:4000, prod same-origin behind nginx) that already had to get the FIRST cookie right. A bearer
 * token sidesteps all of that: `app.enableCors()` (main.ts) already reflects back whatever headers a
 * preflight asks for when `allowedHeaders` is left unset, so `Authorization` needs no new CORS
 * wiring, and there is no SameSite/domain question to get wrong in any of the three topologies. The
 * accepted tradeoff, spelled out once here rather than left implicit: the frontend holds this token in
 * `localStorage` (`hooks/use-portal-fetch.ts`), not an httpOnly cookie, so a script-injection (XSS) bug
 * anywhere on `/portal/*` could read it — the same exposure this codebase already accepts for its own
 * API-key mechanism (`utils/api-key.ts`), and bounded the same two ways: a finite TTL
 * (`portal-tokens.service.ts`'s own `DEFAULT_TTL_MS`) and one-call revocation
 * (`PortalTokensService.revoke`/`revokeAll`) a company member can reach at any time from the client's
 * own screen.
 *
 * ## What a leaked token can, and cannot, do
 *
 * A leaked (or stolen) portal token grants READ access to every one of this ONE client's own
 * `clientVisible` documents and their aggregate balance, plus the two narrow writes
 * `PortalController` exposes: requesting a quote signature (which itself still requires the SEPARATE,
 * OTP-hardened `/signature/:token` flow to actually complete — see `portal.service.ts`'s own
 * `requestQuoteSignature`) and refusing a quote (a reversible, non-legal preference, not a forged
 * acceptance). It grants NOTHING about any OTHER client of this company (enforced by
 * `ActivePortalClient`'s own `clientId`, checked on every read — see `portal.service.ts`), NOTHING
 * about the company's own staff-facing screens (a portal token is never accepted by `AuthGuard`), and
 * NOTHING once expired or revoked (checked on every single call below, never cached).
 */
export interface PortalIdentity {
  companyId: string;
  clientId: string;
  /** The RAW bearer token this request itself authenticated with — never persisted anywhere new, just
   *  handed back to whichever handler already has the header (`extractBearerToken` below already
   *  parsed it once; this avoids re-parsing it a second time at the one call site that needs the raw
   *  value itself: `PortalService.createInvoiceCheckoutSession`, which embeds it in the payment
   *  provider's `successUrl`/`cancelUrl` so the buyer's browser lands back on `/portal/<token>` —
   *  the SAME bootstrap route `[token].tsx` already exists for the emailed link, never a second one). */
  token: string;
}

interface RequestWithPortalIdentity extends Request {
  portal?: PortalIdentity;
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

@Injectable()
export class PortalAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPortalIdentity>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing portal access token.');
    }

    const record = await findPortalTokenByHash(hashPortalToken(token));
    // Unknown, expired, and revoked all answer the SAME 401, with the SAME message — the identical
    // "never let a caller distinguish which of the three applies" discipline
    // `ShareLinksService.resolvePublicToken`/`SignaturesService.resolveActiveOrThrow` already hold for
    // their own bearer-token flows.
    if (!record || record.revokedAt || record.expiresAt <= new Date()) {
      throw new UnauthorizedException('This portal link is invalid, expired, or revoked.');
    }

    touchPortalTokenLastUsed(record.id);
    request.portal = { companyId: record.companyId, clientId: record.clientId, token };
    return true;
  }
}
