import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

// Namespace import, not a default one — see `modules/webhooks/webhook-url-guard.ts`'s own comment for
// why: `import dns from 'node:dns'` compiles under `nest build`'s CommonJS interop helper but resolves
// to `undefined` under this project's ts-jest config (no `esModuleInterop`), which would make
// `dns.promises.resolveTxt` crash in every test rather than hit the `jest.mock('node:dns', ...)` this
// file's own spec relies on. `import * as dns` behaves identically under both compilers.
import * as dns from 'node:dns';

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
import {
  buildVerificationRecordName,
  buildVerificationRecordValue,
  generateVerificationToken,
  matchesVerificationToken,
} from '@/lib/sso-domain-verification';
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
   * Every domain this company has claimed, and its verification state — see `SsoDomainStatus` below.
   * Replaces what used to be a single `domainsVerified: boolean` covering a WHOLE `emailDomains: []`
   * array: that shape could not express "acme.com is proven, gmail.com (added later) is not" — see
   * `CompanySsoDomain`'s own schema comment for the full reasoning. Not a secret list: the company
   * typed every one of these domains itself, and the DNS record values are meant to be published in
   * PUBLIC DNS by design.
   */
  domains: SsoDomainStatus[];
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
  isActive?: boolean;
}

/**
 * One domain claim, reduced to what the settings screen needs: whether it is proven yet, and — for the
 * "publish this in DNS" instructions — the exact record name and value to use, regardless of whether
 * verification already succeeded (re-displaying them is harmless: both are meant to be public).
 */
export interface SsoDomainStatus {
  id: string;
  domain: string;
  verified: boolean;
  recordName: string;
  recordValue: string;
}

/** A `CompanySsoDomain` row (or anything shaped like one) reduced to its `SsoDomainStatus`. */
const toDomainStatus = (row: {
  id: string;
  domain: string;
  token: string;
  verifiedAt: Date | null;
}): SsoDomainStatus => ({
  id: row.id,
  domain: row.domain,
  verified: row.verifiedAt != null,
  recordName: buildVerificationRecordName(row.domain),
  recordValue: buildVerificationRecordValue(row.token),
});

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
    const row = await prisma.companySsoProvider.findUnique({
      where: { companyId },
      include: { domains: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) return null;
    return {
      providerId: companyProviderId(row.companyId),
      label: row.label,
      issuerHost: issuerHostOf(row),
      isActive: row.isActive,
      redirectUri: this.redirectUriFor(companyId),
      domains: row.domains.map(toDomainStatus),
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
   * This write NEVER touches `CompanySsoDomain` — not to insert a row, not to clear one, not even to
   * touch an unrelated column on an existing one. Domain claims and their verification live entirely
   * behind the dedicated `/company/sso/domains` routes below, so that editing this provider's label or
   * rotating its client secret can never, as a side effect, grant or revoke a domain's verified state.
   * `sso.service.spec.ts` carries the mutation proof.
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
    const label = blank(body.label) ?? 'SSO';
    const isActive = body.isActive ?? true;
    const encrypted = encryptJson(credentials);

    const row = await prisma.companySsoProvider.upsert({
      where: { companyId },
      create: { companyId, label, ...endpoints, scopes, credentials: encrypted, isActive },
      update: { label, ...endpoints, scopes, credentials: encrypted, isActive },
      include: { domains: { orderBy: { createdAt: 'asc' } } },
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
      domains: row.domains.map(toDomainStatus),
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
   * pure `resolveSsoLookup`, which matches exclusively on an ACTIVE row where the SPECIFIC domain
   * asked for is VERIFIED. The query is already narrowed to `CompanySsoDomain` rows claiming this
   * exact domain string, under an active provider, so a non-matching address cannot be used to
   * enumerate anything — `resolveSsoLookup` still re-checks both `isActive` and verification itself,
   * the same belt-and-suspenders structure this method held before the domain table existed, so the
   * security property is provable from the pure function alone, without trusting this query to be
   * exactly right.
   */
  async lookupByEmail(email: string): Promise<SsoLookupResult | null> {
    // `emailDomain` is the ONE place the "what counts as a domain" rule lives, and reusing it here is
    // what keeps the row this QUERIES for identical to the row `resolveSsoLookup` will then ACCEPT.
    // This line used to do its own split, which accepted "alice@ acme.com" and went looking for
    // " acme.com" — two slightly different rules for the same question.
    const domain = emailDomain(email);
    if (!domain) return null;

    const rows = await prisma.companySsoDomain.findMany({
      where: { domain, provider: { isActive: true } },
      // Oldest verification wins. In the ordinary case there is at most one VERIFIED row for a given
      // domain (see `verifyDomain`'s advisory lock, which is what actually enforces that), so this
      // ordering changes nothing day to day — but if the database is ever in the pathological state
      // where two rows are both verified for the same domain (a pre-existing race predating that
      // lock, or a future bug), this is what makes routing a DETERMINISTIC, explainable pick — the
      // earliest `verifiedAt` — rather than whatever order Postgres happens to return matching rows
      // in, which is unspecified and can change between calls. Ties among unverified rows (null
      // `verifiedAt`) don't matter: `resolveSsoLookup` never matches them.
      orderBy: { verifiedAt: 'asc' },
      select: {
        domain: true,
        verifiedAt: true,
        provider: { select: { companyId: true, label: true, isActive: true } },
      },
    });

    const candidates: SsoLookupCandidate[] = rows.map((row) => ({
      providerId: companyProviderId(row.provider.companyId),
      label: row.provider.label,
      isActive: row.provider.isActive,
      // Only ever ONE domain per candidate here (the query is already narrowed to `domain`), but the
      // pure function's contract is "a row's verified domains", so the shape stays a list rather than
      // adding a second, single-domain-only path just for this call site.
      verifiedDomains: row.verifiedAt != null ? [row.domain] : [],
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

  // ---------------------------------------------------------------------------
  // Domain claims and their DNS TXT verification — GET/POST /company/sso/domains,
  // POST /company/sso/domains/:id/verify, DELETE /company/sso/domains/:id
  // ---------------------------------------------------------------------------

  /** Every domain this company has claimed, verified or not — what the settings screen lists. */
  async listDomains(companyId: string): Promise<SsoDomainStatus[]> {
    const provider = await prisma.companySsoProvider.findUnique({
      where: { companyId },
      select: { domains: { orderBy: { createdAt: 'asc' } } },
    });
    // No provider row yet is not an error here (unlike `addDomain`, which must refuse it): a company
    // that has configured nothing simply has no domains to list, the same way an empty list is not an
    // error for `webhooks.service.ts#list`.
    return provider ? provider.domains.map(toDomainStatus) : [];
  }

  /**
   * Claim a domain: mints a verification token and returns the DNS record to publish. Requires an
   * existing provider row (`CompanySsoDomain.providerId` is a foreign key to it, and a claim with no
   * OIDC configuration behind it could never be signed into anyway) — configure the provider first via
   * `upsert()`.
   *
   * Re-adding a domain that is already claimed but UNVERIFIED re-mints its token rather than erroring:
   * the caller may simply have lost the original value, or be rotating it for hygiene, and refusing a
   * harmless retry would only push them toward "remove, then re-add" for the exact same effect. A
   * domain that is already VERIFIED is left untouched — see the branch below for why.
   */
  async addDomain(companyId: string, rawDomain: string): Promise<SsoDomainStatus> {
    const [domain] = normalizeDomains(rawDomain);
    if (!domain) {
      throw new BadRequestException('A valid bare domain is required (e.g. "acme.com").');
    }

    const provider = await prisma.companySsoProvider.findUnique({ where: { companyId } });
    if (!provider) {
      throw new NotFoundException('Configure an SSO provider before claiming a domain.');
    }

    const existing = await prisma.companySsoDomain.findUnique({
      where: { providerId_domain: { providerId: provider.id, domain } },
    });

    // An already-VERIFIED domain must not be handed a fresh, unpublished token just because the same
    // claim was submitted again — that would silently downgrade a proven domain back to "not verified
    // in practice" (the OLD token is still what the caller's DNS zone carries) until they notice and
    // re-publish, for zero benefit.
    const row =
      existing?.verifiedAt != null
        ? existing
        : await prisma.companySsoDomain.upsert({
            where: { providerId_domain: { providerId: provider.id, domain } },
            create: { providerId: provider.id, domain, token: generateVerificationToken() },
            update: { token: generateVerificationToken() },
          });

    credentialAudit.emit({
      companyId,
      credentialRef: `sso-domain:${companyProviderId(companyId)}:${domain}`,
      action: 'UPLOAD',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
    });

    return toDomainStatus(row);
  }

  /** Removes a domain claim outright — an unverified claim is nobody's business to keep around. */
  async removeDomain(companyId: string, id: string): Promise<{ deleted: boolean }> {
    // Scoped through the relation, exactly like every other per-company lookup in this codebase: `id`
    // arrives untrusted off the wire, and matching it against `provider.companyId` in the SAME query is
    // what makes it impossible for company A to delete company B's claim by guessing or enumerating ids
    // — there is no separate "does this belong to me" check to forget to add later.
    const { count } = await prisma.companySsoDomain.deleteMany({ where: { id, provider: { companyId } } });
    credentialAudit.emit({
      companyId,
      credentialRef: `sso-domain:${companyProviderId(companyId)}:${id}`,
      action: 'DELETE',
      outcome: count > 0 ? 'HIT' : 'MISS',
      timestamp: new Date().toISOString(),
    });
    return { deleted: count > 0 };
  }

  /**
   * Runs the DNS TXT challenge for one claimed domain and, on success, writes `verifiedAt` — the ONLY
   * place in this codebase that column is ever written.
   *
   * Three distinct failure shapes, all surfaced as an actionable 4xx rather than a 500: the record does
   * not exist yet (the ordinary "haven't published it yet" case), the record exists but does not carry
   * the expected value (a typo, or a stale token from before a re-mint), and a genuine DNS failure
   * (timeout, resolver outage) — none of these may ever be mistaken for a pass.
   *
   * Every branch — success, each failure shape above, the 409 conflict, and a transaction failure —
   * calls `credentialAudit.emit(...)`, the same "log every reason, not just the win" discipline
   * `resolveForRegistration`'s `miss()` helper holds elsewhere in this file. A domain-verification
   * attempt is itself a security-relevant event (someone is trying to prove control of a domain to
   * route sign-ins at it), so an operator investigating "why is our domain not verifying" or "who kept
   * trying to claim this domain" needs the failed attempts in the log, not only the eventual success.
   * None of these events carry a token, a client secret, or ciphertext — only `companyId`, an opaque
   * `credentialRef` (built from the company's own provider id and the domain it typed in), and a short
   * machine-readable `reason` string.
   */
  async verifyDomain(companyId: string, id: string): Promise<SsoDomainStatus> {
    const claim = await prisma.companySsoDomain.findFirst({ where: { id, provider: { companyId } } });
    if (!claim) {
      // Audited like every other failure branch below (see this method's own header on why they all
      // are now) — `id` is the only fact known at this point, since there is no row to read a domain
      // off of; that alone is not a secret (it is the exact value the caller itself just supplied).
      credentialAudit.emit({
        companyId,
        credentialRef: `sso-domain:${companyProviderId(companyId)}:${id}`,
        action: 'VERIFY',
        outcome: 'MISS',
        timestamp: new Date().toISOString(),
        context: { reason: 'claim_not_found' },
      });
      throw new NotFoundException('No such domain claim for this company.');
    }

    // Idempotent: a caller re-clicking "Verify" on an already-proven domain should see the same
    // success again, not pay for a fresh DNS round-trip and a fresh pass through the conflict
    // transaction below for a fact that is already settled.
    if (claim.verifiedAt != null) {
      return toDomainStatus(claim);
    }

    const recordName = buildVerificationRecordName(claim.domain);
    const expectedValue = buildVerificationRecordValue(claim.token);

    // The credentialRef every audit event below for THIS claim shares — same shape as the success
    // event at the bottom of this method, so a log search for one `sso-domain:...` ref surfaces every
    // attempt, failed or not.
    const credentialRef = `sso-domain:${companyProviderId(companyId)}:${claim.domain}`;

    let records: string[][];
    try {
      records = await dns.promises.resolveTxt(recordName);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOTFOUND' || code === 'ENODATA') {
        // The ordinary "not published yet" case — actionable by the caller, and expected to happen on
        // the very first attempt every time, so it is a 400 naming exactly what to do next, never a
        // server error.
        credentialAudit.emit({
          companyId,
          credentialRef,
          action: 'VERIFY',
          outcome: 'MISS',
          timestamp: new Date().toISOString(),
          context: { reason: 'record_not_published' },
        });
        throw new BadRequestException(
          `No TXT record found at "${recordName}" yet. Publish the value "${expectedValue}" there and ` +
            'try again.',
        );
      }
      // Any OTHER DNS failure (timeout, SERVFAIL, a resolver outage on our side) is still a failure to
      // verify — it must never be treated as a pass just because it isn't the "not published yet" case.
      this.logger.warn(`DNS TXT lookup for ${recordName} failed: ${(err as Error).message}`);
      credentialAudit.emit({
        companyId,
        credentialRef,
        action: 'VERIFY',
        outcome: 'ERROR',
        timestamp: new Date().toISOString(),
        context: { reason: 'dns_lookup_failed' },
      });
      throw new BadRequestException('DNS verification failed. Please try again in a few minutes.');
    }

    if (!matchesVerificationToken(records, claim.token)) {
      credentialAudit.emit({
        companyId,
        credentialRef,
        action: 'VERIFY',
        outcome: 'MISS',
        timestamp: new Date().toISOString(),
        context: { reason: 'value_mismatch' },
      });
      throw new BadRequestException(
        `The TXT record at "${recordName}" does not carry the expected value "${expectedValue}" yet. ` +
          'Publish it exactly and try again.',
      );
    }

    try {
      await prisma.$transaction(async (tx) => {
        // First verified wins. There is deliberately no database constraint stopping two DIFFERENT
        // providers from both holding an UNVERIFIED row for the same domain string (see
        // `CompanySsoDomain`'s own schema comment for why a global unique index would itself be a
        // hazard) — so this is the one place that actually enforces "at most one company may be
        // VERIFIED for a given domain at a time", inside a transaction so the check-then-write is
        // atomic. The refusal message names only the domain, never the other company: this route is
        // reachable by anyone who can claim a domain, and confirming that some OTHER named tenant holds
        // it would itself be information this endpoint has no business revealing.
        //
        // "Atomic" needs a lock, not just a transaction: `prisma.service.ts` opens this client with no
        // isolation override, so this transaction runs at Postgres's default READ COMMITTED, under
        // which a `findFirst` followed by an `update` is NOT atomic against another transaction doing
        // the same thing concurrently — each can run its `findFirst` before the other's `update`
        // commits, see no conflict, and both write `verifiedAt`. That is a real race: two DIFFERENT
        // `CompanySsoDomain` rows (different `providerId`, i.e. different companies) can share the same
        // `domain` string, since the unique index is `(providerId, domain)`, never a bare `domain` (see
        // that index's own comment) — and both racers can only reach this code at all by having
        // independently passed the real DNS TXT challenge above, so this is not a way to steal a domain
        // without owning it, only a way to end the race with two "winners" instead of one.
        //
        // A transaction-scoped Postgres advisory lock keyed on the domain string closes the window:
        // this call blocks the SECOND racer until the FIRST racer's transaction commits (releasing the
        // lock automatically — `_xact_lock` variants always release at transaction end, never needing
        // an explicit unlock) or rolls back, so by the time the second racer's `findFirst` below runs,
        // the first racer's `update` has either landed or been undone. Scoped to THIS domain only:
        // verifying "other.example" never waits on anyone verifying "acme.com".
        //
        // `hashtext()` is a 32-bit hash, so two unrelated domain strings can collide onto the same lock
        // key. That is harmless and must stay harmless: a collision only ever makes two UNRELATED
        // verification attempts briefly serialize against each other (one waits a moment longer than
        // strictly necessary) — it can never make either of them SKIP the conflict check below, because
        // that check still queries by the real `domain` string, not by the hash. Do not "improve" this
        // into a wider hash or a two-key `pg_advisory_xact_lock(int, int)` form to chase the collision
        // away: there is no correctness bug here for a wider key to fix, only a false sense that one
        // exists. The alternative of a `Serializable` transaction plus an application-level retry loop
        // on Postgres's `40001` serialization-failure error would be equally correct but strictly more
        // code for no extra safety in this specific race (a single conflict-then-write, not a multi-step
        // read pattern), so it is not used here.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claim.domain}))`;

        const conflict = await tx.companySsoDomain.findFirst({
          where: { domain: claim.domain, verifiedAt: { not: null }, NOT: { id: claim.id } },
        });
        if (conflict) {
          throw new ConflictException(
            `"${claim.domain}" is already verified on a different account. If you believe this is a ` +
              'mistake, contact support.',
          );
        }
        await tx.companySsoDomain.update({ where: { id: claim.id }, data: { verifiedAt: new Date() } });
      });
    } catch (err) {
      credentialAudit.emit({
        companyId,
        credentialRef,
        action: 'VERIFY',
        outcome: err instanceof ConflictException ? 'MISS' : 'ERROR',
        timestamp: new Date().toISOString(),
        context: { reason: err instanceof ConflictException ? 'domain_claimed_elsewhere' : 'write_failed' },
      });
      throw err;
    }

    credentialAudit.emit({
      companyId,
      credentialRef,
      action: 'VERIFY',
      outcome: 'HIT',
      timestamp: new Date().toISOString(),
    });

    return toDomainStatus({ ...claim, verifiedAt: new Date() });
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
