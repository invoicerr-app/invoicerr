import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

// Namespace import, not a default one: `import dns from 'node:dns'` resolves to undefined under
// ts-jest, breaking the `jest.mock('node:dns')` this file's spec relies on.
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
import { OutboundUrlValidationError, assertPublicOutboundUrl } from '@/utils/outbound-url';

/**
 * The secret half of an SSO configuration, the only thing inside the encrypted blob. The client id
 * lives here too, so there is one ciphertext to manage, rotate and audit.
 */
interface SsoCredentials {
  clientId: string;
  /** Absent for a public client (PKCE only) — `GenericOAuthConfig.clientSecret` is itself optional. */
  clientSecret?: string;
}

/**
 * Everything needed to build a better-auth provider, decrypted. Server-side only, never handed to a
 * controller; `SsoProviderStatus` is the only shape a response may carry.
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
 * What the boot path reads: enough to decide whether a row is worth registering, never the
 * credentials. Decryption waits until the provider is actually built, so a boot never decrypts every
 * tenant's secret just to learn a row exists.
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
 * What GET returns: status only. The response type has nowhere to put a credential, which is sturdier
 * than trusting a masking step to run on every call site.
 *
 * `issuerHost` is a host, never a full URL with its query string, so an admin can see which IdP is
 * configured without echoing a stored value back. `redirectUri` comes from `APP_URL` and the provider
 * id only, and the customer needs it to register this application at their own IdP.
 */
export interface SsoProviderStatus {
  providerId: string;
  label: string;
  issuerHost: string | null;
  isActive: boolean;
  redirectUri: string;
  /**
   * Every claimed domain with its verification state, so "acme.com is proven, gmail.com is not" can be
   * expressed. Not a secret list: the company typed these, and the DNS values are public by design.
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

/**
 * SSRF guard for the four IdP endpoints a company types in: they are handed to better-auth's
 * `genericOAuth`, which fetches the discovery document and then POSTs this tenant's client credentials
 * to whichever `token_endpoint` that document names, a second attacker-controlled hop. https and port
 * 443 only; the private-range block and DNS re-resolution come from the shared outbound-URL guard.
 *
 * Re-run in `sso-registrar.service.ts#buildCompanyProvider` right before better-auth dials a URL: the
 * write-time check alone leaves a DNS-rebinding window.
 *
 * Unlike the webhook and transport guards, this cannot pin the connection to the validated address:
 * the real calls happen inside better-auth's `genericOAuth` and `betterFetch`, with no dispatcher or
 * fetch override exposed. A residual rebinding window therefore remains between this validation and
 * the library's own resolution, narrowed but not eliminated; closing it would mean patching the
 * library.
 */
async function assertEndpointsArePublic(endpoints: {
  discoveryUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
}): Promise<void> {
  const allowPrivateForTesting = process.env.ALLOW_PRIVATE_OUTBOUND_URLS === '1';
  for (const [field, url] of Object.entries(endpoints)) {
    if (!url) continue;
    try {
      await assertPublicOutboundUrl(url, { allowPrivateForTesting });
    } catch (err) {
      if (err instanceof OutboundUrlValidationError) {
        // Never echo the reason or the URL: either would make this a scanning oracle.
        throw new BadRequestException(`${field} must be a public https:// endpoint on port 443.`);
      }
      throw err;
    }
  }
}

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
 * Per-company OIDC single sign-on: the rows behind the SSO settings screen and the runtime provider
 * registration. The only place `CompanySsoProvider` rows are read or written. Secrets in one
 * AES-256-GCM blob with the shared key, non-secret columns in the clear so the screen renders without
 * decrypting, and an audit event on every resolve and write.
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
   * The redirect URI the customer registers at their IdP. better-auth's callback is `/callback/:id`, so
   * the company id in the provider id is what makes the URI company-specific. Built from `APP_URL`, the
   * same base better-auth uses, so the two cannot disagree.
   */
  redirectUriFor(companyId: string): string {
    const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return `${base}/api/auth/callback/${companyProviderId(companyId)}`;
  }

  /**
   * Creates or updates the SSO provider. Credentials are encrypted at rest and the return value is
   * status-only, so no response ever echoes a secret.
   *
   * This write never touches `CompanySsoDomain`: domain claims live behind their own routes, so
   * editing a label or rotating a secret can never grant or revoke a domain's verified state.
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

    await assertEndpointsArePublic(endpoints);

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
   * Which provider an email domain should sign in to, or null.
   *
   * Anonymous and rate-limited: it reads only the columns the decision needs and leaves matching to
   * the pure `resolveSsoLookup`, which requires an active provider and a verified domain for that exact
   * host, so a non-matching address cannot enumerate anything.
   */
  async lookupByEmail(email: string): Promise<SsoLookupResult | null> {
    // `emailDomain` is the one place the "what counts as a domain" rule lives, so the row queried here
    // is exactly the row `resolveSsoLookup` will accept.
    const domain = emailDomain(email);
    if (!domain) return null;

    const rows = await prisma.companySsoDomain.findMany({
      where: { domain, provider: { isActive: true } },
      // Oldest verification wins, so routing stays deterministic if two rows ever end up verified for
      // the same domain.
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
      // One domain per candidate here, but the pure function takes a row's verified domains as a list.
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
   * One company's decrypted provider configuration, for building the better-auth provider. Null rather
   * than a throw when the row is absent, inactive, incomplete, corrupted, or encryption is unavailable:
   * the registrar treats all of those as "no usable SSO".
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
    // No provider row yet is not an error here: a company that configured nothing simply has no
    // domains to list.
    return provider ? provider.domains.map(toDomainStatus) : [];
  }

  /**
   * Claims a domain: mints a verification token and returns the DNS record to publish. Requires an
   * existing provider row, since a claim with no OIDC configuration could never be signed into.
   *
   * Re-adding an unverified domain re-mints its token, because the caller may have lost it; a verified
   * domain is left untouched.
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

    // Re-minting a verified domain would downgrade it in practice: the caller's DNS zone still
    // carries the old token.
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
    // Scoped through the relation: `id` arrives untrusted, and matching it against `provider.companyId`
    // in the same query is what stops company A deleting company B's claim.
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
   * Runs the DNS TXT challenge for one claim and, on success, writes `verifiedAt`.
   *
   * The three failure shapes are 4xx, never a 500 and never a pass: record missing, record without the
   * expected value, and a genuine DNS failure. Every branch audits the attempt, since proving control
   * of a domain is security-relevant; the events carry no token, secret or ciphertext.
   */
  async verifyDomain(companyId: string, id: string): Promise<SsoDomainStatus> {
    const claim = await prisma.companySsoDomain.findFirst({ where: { id, provider: { companyId } } });
    if (!claim) {
      // Audited like every other failure branch; `id` is the only fact known, and the caller just
      // supplied it.
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

    // Idempotent: re-clicking Verify on a proven domain answers success without a DNS round trip.
    if (claim.verifiedAt != null) {
      return toDomainStatus(claim);
    }

    const recordName = buildVerificationRecordName(claim.domain);
    const expectedValue = buildVerificationRecordValue(claim.token);

    // One credentialRef for every audit event of this claim, so a log search surfaces every attempt.
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
        // First verified wins. No database constraint stops two providers holding an unverified row for
        // the same domain (the unique index is (providerId, domain)), so this check enforces "one
        // verified company per domain". The refusal names only the domain: naming the other tenant
        // would reveal information to anyone who can claim a domain.
        //
        // A transaction is not enough: at READ COMMITTED a findFirst then update is not atomic against
        // another racer, and both can write `verifiedAt`. A transaction-scoped advisory lock on the
        // domain serializes the second racer until the first commits. A hashtext collision only makes
        // two unrelated verifications wait a moment; the conflict check still queries the real domain.
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
