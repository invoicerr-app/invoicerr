import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import {
  SsoLookupCandidate,
  SsoLookupResult,
  companyProviderId,
  emailDomain,
  normalizeDomains,
  resolveSsoLookup,
  ssoEndpointsComplete,
} from '@/lib/sso-policy';
import { decryptJson, encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';
import { credentialAudit } from '@/utils/credential-access-audit';

/**
 * The secret half of a company's SSO configuration — the ONLY thing that lives inside the encrypted
 * blob. A client id is not strictly a secret, but it belongs to the same credential pair and storing
 * it alongside the secret means there is exactly ONE ciphertext to manage, rotate and audit, the same
 * discipline `CompanyChannelConfig.config` holds for a whole credentials blob.
 */
interface SsoCredentials {
  clientId: string;
  /** Absent for a public client (PKCE only) — `GenericOAuthConfig.clientSecret` is itself optional. */
  clientSecret?: string;
}

/**
 * Everything needed to BUILD a better-auth provider, decrypted. Server-side only: this is handed to
 * `sso-registrar.service.ts`, never to a controller. See `SsoProviderStatus` below for the only shape
 * an HTTP response may carry.
 */
export interface SsoProviderResolved {
  companyId: string;
  providerId: string;
  label: string;
  discoveryUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  scopes: string[];
  clientId: string;
  clientSecret?: string;
}

/**
 * What the boot/registration path reads: enough to decide whether a row is worth registering, and
 * under which id — and deliberately NOT the credentials. Decryption is deferred to the moment the
 * provider is actually built (see the registrar's thunk), so booting the API never decrypts every
 * tenant's secret just to learn that a row exists.
 */
export interface SsoRegistrationRow {
  companyId: string;
  providerId: string;
  label: string;
  discoveryUrl: string | null;
  authorizationUrl: string | null;
  tokenUrl: string | null;
}

/**
 * What GET returns — status ONLY. The surest way to honour "an SSO response never carries a
 * credential" is for the response TYPE to have nowhere to put one, rather than trusting a masking
 * step to run correctly on every call site forever. Exactly the reasoning
 * `channels.service.ts`'s `ChannelConfigStatus` and `signing-certificates`' `toMeta()` already apply;
 * `sso.service.spec.ts` carries the mutation proof.
 *
 * `issuerHost` is a HOST, never a full URL with its query string: it answers "which IdP is this
 * pointed at" for an admin checking their own configuration, without echoing back a configuration
 * value. `redirectUri` is derived purely from `APP_URL` and the provider id — it contains nothing from
 * the encrypted blob, and the customer needs it to register this application at their own IdP.
 */
export interface SsoProviderStatus {
  providerId: string;
  label: string;
  issuerHost: string | null;
  isActive: boolean;
  redirectUri: string;
  /**
   * Whether the claimed email domains have been PROVEN to belong to this company. Always false today:
   * this feature ships no verification challenge, and the email-first lookup refuses to match an
   * unverified row — see `sso-policy.ts#resolveSsoLookup`. Surfaced so the settings screen can say so
   * out loud rather than implying the domain list does something it does not.
   */
  domainsVerified: boolean;
  /** The domains this company claims. Not a secret: the company typed them itself. */
  emailDomains: string[];
}

export interface UpsertSsoProviderBody {
  label?: string;
  discoveryUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  scopes?: string[] | string;
  clientId?: string;
  clientSecret?: string;
  emailDomains?: string[] | string;
  isActive?: boolean;
}

/** Trim to undefined: a blank string from a form field means "not set", never an empty endpoint. */
const blank = (value: string | undefined | null): string | undefined => {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** The host of whichever URL identifies the IdP, for the status response. Never throws on junk. */
const issuerHostOf = (row: {
  discoveryUrl: string | null;
  authorizationUrl: string | null;
}): string | null => {
  for (const candidate of [row.discoveryUrl, row.authorizationUrl]) {
    if (!candidate) continue;
    try {
      return new URL(candidate).host;
    } catch {
      // A stored value that is not a parseable URL tells the admin nothing useful; say nothing rather
      // than echo the raw string back.
    }
  }
  return null;
};

/**
 * Per-company OIDC single sign-on — the stored rows behind the "SSO" company-settings screen and
 * behind the runtime provider registration.
 *
 * `Controller → Service → Prisma`: this is the ONE place `CompanySsoProvider` rows are read or
 * written. Modelled field-for-field on `channels/channels.service.ts`: secrets in one AES-256-GCM
 * blob via `utils/secret-crypto.ts` (the same `CREDENTIALS_ENCRYPTION_KEY`, never a second scheme),
 * non-secret columns in the clear so the screen can render without decrypting, and a
 * `credentialAudit.emit(...)` on every resolve and every write.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  // ---------------------------------------------------------------------------
  // The CONTROLLER surface
  // ---------------------------------------------------------------------------

  /** This company's SSO configuration — STATUS ONLY (see `SsoProviderStatus`), or null if none. */
  async getStatus(companyId: string): Promise<SsoProviderStatus | null> {
    const row = await prisma.companySsoProvider.findUnique({ where: { companyId } });
    if (!row) return null;
    return {
      providerId: companyProviderId(row.companyId),
      label: row.label,
      issuerHost: issuerHostOf(row),
      isActive: row.isActive,
      redirectUri: this.redirectUriFor(companyId),
      domainsVerified: row.domainsVerifiedAt != null,
      emailDomains: row.emailDomains,
    };
  }

  /**
   * The redirect URI the customer must register at their own IdP.
   *
   * This is the whole reason the company id lives inside the provider id: better-auth's callback route
   * is `/callback/:id`, so the URI is fully determined by the company. Built from `APP_URL` — the same
   * base better-auth itself uses (`lib/auth.ts`'s `baseURL`), so the two cannot disagree.
   */
  redirectUriFor(companyId: string): string {
    const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return `${base}/api/auth/callback/${companyProviderId(companyId)}`;
  }

  /**
   * Create or update this company's SSO provider.
   *
   * The credentials are encrypted at rest and the RETURN VALUE is status-only: a caller that just
   * supplied the secret does not need it echoed back, which keeps "no response ever carries a
   * credential" true of every response this service hands a controller, not just the plain GET.
   *
   * `domainsVerifiedAt` is NEVER written here — not even to `null` explicitly on update, so that a
   * future verification challenge which sets it cannot be silently undone by an unrelated edit. See
   * `sso-policy.ts#resolveSsoLookup` for why an unverified domain list must not route anyone.
   */
  async upsert(companyId: string, body: UpsertSsoProviderBody): Promise<SsoProviderStatus> {
    if (!isEncryptionAvailable()) {
      throw new ServiceUnavailableException(
        'CREDENTIALS_ENCRYPTION_KEY is not configured on this server — SSO credentials cannot be ' +
          'saved. Set it (see utils/secret-crypto.ts) before connecting an identity provider.',
      );
    }

    const clientId = blank(body.clientId);
    if (!clientId) {
      throw new BadRequestException('clientId is required.');
    }

    const endpoints = {
      discoveryUrl: blank(body.discoveryUrl),
      authorizationUrl: blank(body.authorizationUrl),
      tokenUrl: blank(body.tokenUrl),
      userInfoUrl: blank(body.userInfoUrl),
    };

    if (!ssoEndpointsComplete(endpoints)) {
      throw new BadRequestException(
        'Provide either a discovery URL (.well-known/openid-configuration) or both an authorization ' +
          'URL and a token URL.',
      );
    }

    const credentials: SsoCredentials = { clientId };
    const clientSecret = blank(body.clientSecret);
    if (clientSecret) {
      credentials.clientSecret = clientSecret;
    }

    const scopes = normalizeScopes(body.scopes);
    const emailDomains = normalizeDomains(body.emailDomains);
    const label = blank(body.label) ?? 'SSO';
    const isActive = body.isActive ?? true;
    const encrypted = encryptJson(credentials);

    const row = await prisma.companySsoProvider.upsert({
      where: { companyId },
      create: { companyId, label, ...endpoints, scopes, credentials: encrypted, emailDomains, isActive },
      update: { label, ...endpoints, scopes, credentials: encrypted, emailDomains, isActive },
    });

    this.logger.log(`SSO provider upserted for company ${companyId} (active: ${isActive})`);
    credentialAudit.emit({
      companyId,
      credentialRef: `sso:${companyProviderId(companyId)}`,
      action: 'UPLOAD',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
    });

    return {
      providerId: companyProviderId(row.companyId),
      label: row.label,
      issuerHost: issuerHostOf(row),
      isActive: row.isActive,
      redirectUri: this.redirectUriFor(companyId),
      domainsVerified: row.domainsVerifiedAt != null,
      emailDomains: row.emailDomains,
    };
  }

  /** Removes this company's SSO configuration entirely — a real delete, like disconnecting a channel. */
  async remove(companyId: string): Promise<{ deleted: boolean }> {
    const { count } = await prisma.companySsoProvider.deleteMany({ where: { companyId } });
    credentialAudit.emit({
      companyId,
      credentialRef: `sso:${companyProviderId(companyId)}`,
      action: 'DELETE',
      outcome: count > 0 ? 'HIT' : 'MISS',
      timestamp: new Date().toISOString(),
    });
    return { deleted: count > 0 };
  }

  // ---------------------------------------------------------------------------
  // The @Public() email-first lookup
  // ---------------------------------------------------------------------------

  /**
   * Which provider an email address should be sent to — `{ providerId, label }` or null.
   *
   * Anonymous and rate-limited, so it reads only the columns the decision needs and hands them to the
   * pure `resolveSsoLookup`, which matches exclusively on an ACTIVE row with VERIFIED domains. The
   * query is already narrowed to rows claiming this exact domain, so a non-matching address cannot be
   * used to enumerate anything.
   */
  async lookupByEmail(email: string): Promise<SsoLookupResult | null> {
    // `emailDomain` is the ONE place the "what counts as a domain" rule lives, and reusing it here is
    // what keeps the row this QUERIES for identical to the row `resolveSsoLookup` will then ACCEPT.
    // This line used to do its own split, which accepted "alice@ acme.com" and went looking for
    // " acme.com" — two slightly different rules for the same question.
    const domain = emailDomain(email);
    if (!domain) return null;

    const rows = await prisma.companySsoProvider.findMany({
      where: { isActive: true, emailDomains: { has: domain } },
      select: { companyId: true, label: true, emailDomains: true, isActive: true, domainsVerifiedAt: true },
    });

    const candidates: SsoLookupCandidate[] = rows.map((row) => ({
      providerId: companyProviderId(row.companyId),
      label: row.label,
      emailDomains: row.emailDomains,
      isActive: row.isActive,
      domainsVerifiedAt: row.domainsVerifiedAt,
    }));

    return resolveSsoLookup(candidates, email);
  }

  // ---------------------------------------------------------------------------
  // The REGISTRATION surface — what sso-registrar.service.ts calls
  // ---------------------------------------------------------------------------

  /**
   * Every active row worth registering, WITHOUT decrypting anything. Rows missing the endpoints a
   * provider cannot be built from are filtered out here rather than failing later inside an OAuth
   * flow.
   */
  async listActiveRegistrations(): Promise<SsoRegistrationRow[]> {
    const rows = await prisma.companySsoProvider.findMany({
      where: { isActive: true },
      select: {
        companyId: true,
        label: true,
        discoveryUrl: true,
        authorizationUrl: true,
        tokenUrl: true,
      },
      orderBy: { companyId: 'asc' },
    });

    return rows
      .filter((row) => ssoEndpointsComplete(row))
      .map((row) => ({
        companyId: row.companyId,
        providerId: companyProviderId(row.companyId),
        label: row.label,
        discoveryUrl: row.discoveryUrl,
        authorizationUrl: row.authorizationUrl,
        tokenUrl: row.tokenUrl,
      }));
  }

  /**
   * One company's full, decrypted provider configuration — for building the better-auth provider.
   *
   * Null (never a throw) when the row is absent, inactive, incomplete, corrupted, or encryption itself
   * is unavailable: the registrar treats every one of those identically as "this company has no usable
   * SSO", exactly as a transport's preflight treats an unresolvable channel.
   */
  async resolveForRegistration(companyId: string): Promise<SsoProviderResolved | null> {
    const providerId = companyProviderId(companyId);
    const miss = (reason: string) => {
      credentialAudit.emit({
        companyId,
        credentialRef: `sso:${providerId}`,
        action: 'RESOLVE',
        outcome: 'MISS',
        timestamp: new Date().toISOString(),
        context: { reason },
      });
      return null;
    };

    if (!isEncryptionAvailable()) return miss('encryption_unavailable');

    const row = await prisma.companySsoProvider.findUnique({ where: { companyId } });
    if (!row) return miss('no_row');
    if (!row.isActive) return miss('inactive');
    if (!ssoEndpointsComplete(row)) return miss('incomplete_endpoints');

    let credentials: SsoCredentials;
    try {
      credentials = decryptJson<SsoCredentials>(row.credentials);
    } catch {
      // Corrupted blob or a rotated key — treat as unconfigured rather than crash a boot or a sign-in.
      credentialAudit.emit({
        companyId,
        credentialRef: `sso:${providerId}`,
        action: 'RESOLVE',
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
        context: { reason: 'decrypt_failed' },
      });
      return null;
    }

    if (!credentials.clientId) return miss('no_client_id');

    credentialAudit.emit({
      companyId,
      credentialRef: `sso:${providerId}`,
      action: 'RESOLVE',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
    });

    return {
      companyId: row.companyId,
      providerId,
      label: row.label,
      discoveryUrl: row.discoveryUrl ?? undefined,
      authorizationUrl: row.authorizationUrl ?? undefined,
      tokenUrl: row.tokenUrl ?? undefined,
      userInfoUrl: row.userInfoUrl ?? undefined,
      scopes: row.scopes,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    };
  }
}

/**
 * Scopes, normalised. "openid" is forced to the front: without it an OIDC provider returns no
 * id_token, which is what better-auth's generic-OAuth plugin reads `sub`/`email` from — a company
 * that edits this field down to "profile email" would otherwise configure a provider that can never
 * identify anybody.
 */
function normalizeScopes(input: string[] | string | undefined): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\s,]+/) : [];
  const scopes = new Set<string>(['openid']);
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const scope = entry.trim();
    if (scope.length > 0) scopes.add(scope);
  }
  // A bare ["openid"] is legitimate, but the overwhelmingly common case wants a name and an address;
  // default to the trio only when the caller expressed no preference at all.
  if (scopes.size === 1 && raw.length === 0) {
    scopes.add('profile');
    scopes.add('email');
  }
  return [...scopes];
}
