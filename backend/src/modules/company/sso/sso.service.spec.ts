/**
 * SsoService in isolation. Mocks `@/prisma/prisma.service` at its own entry point — the same
 * discipline `channels.service.spec.ts` holds — so this proves the SERVICE's own logic (the encryption
 * round-trip, what a response is and is not allowed to carry, what the lookup refuses to match) and
 * never a real database.
 *
 * `CREDENTIALS_ENCRYPTION_KEY` is set here, in-process, to a FIXED test value: this is
 * `utils/secret-crypto.ts`'s real AES-256-GCM, exercised for real, never mocked away.
 *
 * `APP_URL` is pinned for the same reason the key is, and because `process.env` is shared across every
 * spec file running in the same Jest worker — a redirect-URI assertion must not depend on which other
 * spec happened to run first.
 */
process.env.CREDENTIALS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.APP_URL = 'https://invoicerr.example.com';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

// `sso.service.ts` imports `node:dns` as a namespace (`import * as dns`), not a default import — see
// `modules/webhooks/webhook-url-guard.spec.ts`'s own comment for why the mock must match that shape
// exactly (no `__esModule`/`default` wrapper) or `dns.promises.resolveTxt` would see `undefined` under
// this project's ts-jest config and never reach this mock at all.
import * as dns from 'node:dns';

import prisma from '@/prisma/prisma.service';
import { encryptJson } from '@/utils/secret-crypto';
import { SsoService } from './sso.service';

jest.mock('node:dns', () => ({ promises: { resolveTxt: jest.fn() } }));

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySsoProvider: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    companySsoDomain: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    // The interactive-transaction callback is exercised for real here (it receives the SAME mocked
    // client as `tx`, which is enough to prove the conflict-check-then-write sequence `verifyDomain`
    // relies on) rather than stubbed out to a no-op — a no-op would make the 409-conflict tests below
    // unable to prove anything.
    $transaction: jest.fn(),
    // The advisory-lock statement `verifyDomain` issues at the top of its transaction, tagged-template
    // style (`tx.$executeRaw\`...\``). Real Postgres returns the row count (0 for a bare SELECT); the
    // exact value is never inspected by production code, so resolving to anything at all is enough for
    // the mock — only its presence as a callable matters here.
    $executeRaw: jest.fn().mockResolvedValue(0),
  },
}));

const resolveTxt = dns.promises.resolveTxt as unknown as jest.Mock;

const mockedPrisma = prisma as unknown as {
  companySsoProvider: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
  companySsoDomain: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  $transaction: jest.Mock;
  $executeRaw: jest.Mock;
};

const COMPANY_ID = 'clx3k2j1p0000qwer1234asdf';
const PROVIDER_ID = `c_${COMPANY_ID}`;

/** A stored `CompanySsoProvider` row, shaped exactly as Prisma would return it. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'row-1',
  companyId: COMPANY_ID,
  label: 'Acme SSO',
  discoveryUrl: 'https://idp.acme.com/.well-known/openid-configuration',
  authorizationUrl: null,
  tokenUrl: null,
  userInfoUrl: null,
  scopes: ['openid', 'profile', 'email'],
  credentials: encryptJson({ clientId: 'acme-client', clientSecret: 'acme-secret' }),
  domains: [],
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

/** A stored `CompanySsoDomain` row, shaped exactly as Prisma would return it. */
const domainRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'domain-1',
  providerId: 'row-1',
  domain: 'acme.com',
  token: 'a-verification-token',
  verifiedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const VALID_BODY = {
  label: 'Acme SSO',
  discoveryUrl: 'https://idp.acme.com/.well-known/openid-configuration',
  clientId: 'acme-client',
  clientSecret: 'acme-secret',
};

describe('SsoService', () => {
  let service: SsoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SsoService();
    // Default: the transaction callback runs against the SAME mocked client — individual tests
    // override `companySsoDomain.findFirst`/`update` on `mockedPrisma` directly, and this makes those
    // overrides visible to code running "inside" the transaction without a second set of mocks to keep
    // in sync.
    mockedPrisma.$transaction.mockImplementation(async (cb: (tx: typeof mockedPrisma) => unknown) =>
      cb(mockedPrisma),
    );
  });

  describe('upsert → resolveForRegistration — the encryption round-trip', () => {
    it('encrypts on write and decrypts back to the exact same credentials', async () => {
      let stored = '';
      mockedPrisma.companySsoProvider.upsert.mockImplementation(async ({ create }) => {
        stored = create.credentials;
        return row({ credentials: create.credentials });
      });

      await service.upsert(COMPANY_ID, VALID_BODY);

      // What actually reached Prisma is CIPHERTEXT, never the plaintext secret verbatim.
      expect(stored).not.toContain('acme-secret');
      expect(stored).not.toContain('acme-client');

      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(row({ credentials: stored }));

      const resolved = await service.resolveForRegistration(COMPANY_ID);
      expect(resolved).toMatchObject({
        companyId: COMPANY_ID,
        providerId: PROVIDER_ID,
        clientId: 'acme-client',
        clientSecret: 'acme-secret',
        discoveryUrl: 'https://idp.acme.com/.well-known/openid-configuration',
      });
    });

    it('stores a public client (no secret) without inventing one', async () => {
      let stored = '';
      mockedPrisma.companySsoProvider.upsert.mockImplementation(async ({ create }) => {
        stored = create.credentials;
        return row({ credentials: create.credentials });
      });

      await service.upsert(COMPANY_ID, { ...VALID_BODY, clientSecret: '   ' });
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(row({ credentials: stored }));

      const resolved = await service.resolveForRegistration(COMPANY_ID);
      expect(resolved?.clientId).toBe('acme-client');
      expect(resolved?.clientSecret).toBeUndefined();
    });
  });

  describe('the response shape — no endpoint may carry a credential', () => {
    it('getStatus never returns the credentials blob, nor the secret inside it', async () => {
      const marker = 'THIS-MUST-NEVER-LEAK-be3f9c';
      const credentials = encryptJson({ clientId: 'acme-client', clientSecret: marker });
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(row({ credentials }));

      const status = await service.getStatus(COMPANY_ID);

      expect(Object.keys(status!).sort()).toEqual([
        'domains',
        'isActive',
        'issuerHost',
        'label',
        'providerId',
        'redirectUri',
      ]);
      // THE MUTATION PROOF: if this method were ever changed to decrypt and hand back the blob, this
      // is what catches it — neither the secret nor the ciphertext may appear ANYWHERE in the
      // serialised response, not merely be absent from a named field.
      expect(JSON.stringify(status)).not.toContain(marker);
      expect(JSON.stringify(status)).not.toContain(credentials);
      expect(JSON.stringify(status)).not.toContain('acme-client');
    });

    it('upsert echoes back status only, never the secret the same request just carried', async () => {
      mockedPrisma.companySsoProvider.upsert.mockImplementation(async ({ create }) =>
        row({ credentials: create.credentials }),
      );

      const status = await service.upsert(COMPANY_ID, VALID_BODY);

      expect(JSON.stringify(status)).not.toContain('acme-secret');
      expect(Object.keys(status)).not.toContain('credentials');
      expect(Object.keys(status)).not.toContain('clientSecret');
    });

    it('reports the issuer HOST, never a full configured URL', async () => {
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(row());
      const status = await service.getStatus(COMPANY_ID);
      expect(status?.issuerHost).toBe('idp.acme.com');
      expect(status?.issuerHost).not.toContain('/.well-known');
    });

    it('says nothing rather than echoing a stored value that is not a URL', async () => {
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(
        row({ discoveryUrl: 'not a url', authorizationUrl: null }),
      );
      expect((await service.getStatus(COMPANY_ID))?.issuerHost).toBeNull();
    });

    it('is null — not an error — for a company that never configured SSO', async () => {
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(null);
      await expect(service.getStatus(COMPANY_ID)).resolves.toBeNull();
    });
  });

  describe('upsert — validation', () => {
    it('refuses a write with no clientId rather than storing an unusable provider', async () => {
      await expect(service.upsert(COMPANY_ID, { ...VALID_BODY, clientId: '  ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockedPrisma.companySsoProvider.upsert).not.toHaveBeenCalled();
    });

    it('refuses a write with neither a discovery URL nor an authorization+token pair', async () => {
      await expect(
        service.upsert(COMPANY_ID, { clientId: 'x', authorizationUrl: 'https://idp/authorize' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockedPrisma.companySsoProvider.upsert).not.toHaveBeenCalled();
    });

    it('accepts the endpoints spelled out, with no discovery URL', async () => {
      mockedPrisma.companySsoProvider.upsert.mockImplementation(async ({ create }) =>
        row({ ...create, credentials: create.credentials }),
      );
      await expect(
        service.upsert(COMPANY_ID, {
          clientId: 'x',
          authorizationUrl: 'https://idp/authorize',
          tokenUrl: 'https://idp/token',
        }),
      ).resolves.toBeDefined();
    });

    it('throws ServiceUnavailable rather than storing a secret in the clear with no key', async () => {
      const previous = process.env.CREDENTIALS_ENCRYPTION_KEY;
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      try {
        await expect(service.upsert(COMPANY_ID, VALID_BODY)).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
        expect(mockedPrisma.companySsoProvider.upsert).not.toHaveBeenCalled();
      } finally {
        process.env.CREDENTIALS_ENCRYPTION_KEY = previous;
      }
    });

    it('NEVER touches CompanySsoDomain — saving provider settings must not grant or clear verification', async () => {
      // THE MUTATION PROOF for the domain-claim hole: this used to assert that `upsert` never wrote a
      // whole-array `domainsVerifiedAt` column, because doing so would have made every typed-in domain
      // instantly authoritative. That column is gone — verification now lives on its own
      // `CompanySsoDomain` row, written ONLY by `verifyDomain()` — so the property this test protects
      // is the same one restated for the new shape: NOTHING about a provider-settings save (label,
      // endpoints, secret rotation, activation) may create, update, or delete a domain claim's
      // verification state as a side effect.
      mockedPrisma.companySsoProvider.upsert.mockImplementation(async ({ create }) =>
        row({ credentials: create.credentials }),
      );

      await service.upsert(COMPANY_ID, VALID_BODY);

      expect(mockedPrisma.companySsoDomain.create).not.toHaveBeenCalled();
      expect(mockedPrisma.companySsoDomain.update).not.toHaveBeenCalled();
      expect(mockedPrisma.companySsoDomain.upsert).not.toHaveBeenCalled();
      expect(mockedPrisma.companySsoDomain.deleteMany).not.toHaveBeenCalled();
    });

    it('always keeps "openid" in the scopes — without it there is no id_token to identify anyone by', async () => {
      mockedPrisma.companySsoProvider.upsert.mockImplementation(async ({ create }) =>
        row({ credentials: create.credentials }),
      );
      await service.upsert(COMPANY_ID, { ...VALID_BODY, scopes: ['profile', 'email'] });
      expect(mockedPrisma.companySsoProvider.upsert.mock.calls[0][0].create.scopes).toEqual([
        'openid',
        'profile',
        'email',
      ]);
    });
  });

  describe('redirectUriFor — what the customer registers at their own IdP', () => {
    it('is the better-auth callback path carrying this company in the provider id', async () => {
      expect(service.redirectUriFor(COMPANY_ID)).toBe(
        `https://invoicerr.example.com/api/auth/callback/${PROVIDER_ID}`,
      );
    });

    it('is available before anything is configured, and needs no stored row', () => {
      expect(service.redirectUriFor(COMPANY_ID)).toContain('/api/auth/callback/');
      expect(mockedPrisma.companySsoProvider.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('lookupByEmail — the @Public() endpoint', () => {
    /** A `CompanySsoDomain` row joined with the columns of its parent provider the query selects. */
    const domainWithProvider = (overrides: Record<string, unknown> = {}) => ({
      domain: 'acme.com',
      verifiedAt: new Date('2026-01-01T00:00:00Z'),
      provider: { companyId: COMPANY_ID, label: 'Acme SSO', isActive: true },
      ...overrides,
    });

    it('returns ONLY providerId and label for an active row with a VERIFIED domain', async () => {
      mockedPrisma.companySsoDomain.findMany.mockResolvedValue([domainWithProvider()]);

      const result = await service.lookupByEmail('Alice@Acme.com');

      expect(result).toEqual({ providerId: PROVIDER_ID, label: 'Acme SSO' });
      expect(Object.keys(result!).sort()).toEqual(['label', 'providerId']);
      // The provider id necessarily CONTAINS the company id — that is the design (it is also the
      // public redirect-URI path segment the customer registers at their IdP), so it is not a secret
      // and cannot be withheld: the caller needs it to start the OAuth flow. What must never leak is
      // everything ELSE about the company — its claimed domains, its endpoints, its issuer host, its
      // credentials — and nothing here may grow a third field that could carry one.
      expect(result!.providerId).toBe(PROVIDER_ID);
      expect(JSON.stringify(result)).not.toContain('acme.com');
      expect(JSON.stringify(result)).not.toContain('idp.acme.com');
      expect(JSON.stringify(result)).not.toContain('acme-secret');
    });

    it('refuses an UNVERIFIED row even though the query returned it', async () => {
      // The domain-claim hole, closed: the row claims "acme.com" and is active, and the lookup still
      // declines — which is why this endpoint matches nothing at all until the DNS TXT challenge has
      // actually succeeded. Deliberate: honouring an unverified claim would let any company type
      // "gmail.com" and have strangers' sign-ins routed at its own IdP.
      mockedPrisma.companySsoDomain.findMany.mockResolvedValue([domainWithProvider({ verifiedAt: null })]);
      await expect(service.lookupByEmail('alice@acme.com')).resolves.toBeNull();
    });

    it('asks the database only for rows claiming that exact domain under an ACTIVE provider', async () => {
      mockedPrisma.companySsoDomain.findMany.mockResolvedValue([]);
      await service.lookupByEmail('alice@acme.com');
      expect(mockedPrisma.companySsoDomain.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { domain: 'acme.com', provider: { isActive: true } } }),
      );
    });

    it('never selects the credentials column at all on the anonymous path', async () => {
      mockedPrisma.companySsoDomain.findMany.mockResolvedValue([]);
      await service.lookupByEmail('alice@acme.com');
      const { select } = mockedPrisma.companySsoDomain.findMany.mock.calls[0][0];
      expect(JSON.stringify(select)).not.toContain('credentials');
    });

    it.each(['', '   ', 'not-an-email'])('is null for the non-address %p without querying', async (email) => {
      mockedPrisma.companySsoDomain.findMany.mockResolvedValue([]);
      await expect(service.lookupByEmail(email)).resolves.toBeNull();
      expect(mockedPrisma.companySsoDomain.findMany).not.toHaveBeenCalled();
    });
  });

  describe('resolveForRegistration — what the registrar builds a provider from', () => {
    it('is null for a company with no row', async () => {
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(null);
      await expect(service.resolveForRegistration(COMPANY_ID)).resolves.toBeNull();
    });

    it('is null for an INACTIVE row — a deactivated provider must never resolve', async () => {
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(row({ isActive: false }));
      await expect(service.resolveForRegistration(COMPANY_ID)).resolves.toBeNull();
    });

    it('is null for a row missing the endpoints a provider cannot be built without', async () => {
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(
        row({ discoveryUrl: null, authorizationUrl: 'https://idp/authorize', tokenUrl: null }),
      );
      await expect(service.resolveForRegistration(COMPANY_ID)).resolves.toBeNull();
    });

    it('is null — never a throw — for a corrupted blob or a rotated key', async () => {
      // A boot that crashed on one unreadable row would take the whole API down with it.
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(row({ credentials: 'not-ciphertext' }));
      await expect(service.resolveForRegistration(COMPANY_ID)).resolves.toBeNull();
    });

    it('is null when encryption is unavailable, without even querying', async () => {
      const previous = process.env.CREDENTIALS_ENCRYPTION_KEY;
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      try {
        await expect(service.resolveForRegistration(COMPANY_ID)).resolves.toBeNull();
        expect(mockedPrisma.companySsoProvider.findUnique).not.toHaveBeenCalled();
      } finally {
        process.env.CREDENTIALS_ENCRYPTION_KEY = previous;
      }
    });
  });

  describe('listActiveRegistrations — the boot path', () => {
    it('never reads the credentials column: booting must not decrypt every tenant secret', async () => {
      mockedPrisma.companySsoProvider.findMany.mockResolvedValue([]);
      await service.listActiveRegistrations();
      const { select } = mockedPrisma.companySsoProvider.findMany.mock.calls[0][0];
      expect(Object.keys(select)).not.toContain('credentials');
    });

    it('drops a row that could never build a provider instead of registering it', async () => {
      mockedPrisma.companySsoProvider.findMany.mockResolvedValue([
        {
          companyId: 'a',
          label: 'A',
          discoveryUrl: 'https://a/.well-known',
          authorizationUrl: null,
          tokenUrl: null,
        },
        {
          companyId: 'b',
          label: 'B',
          discoveryUrl: null,
          authorizationUrl: 'https://b/auth',
          tokenUrl: null,
        },
      ]);

      const rows = await service.listActiveRegistrations();
      expect(rows.map((r) => r.providerId)).toEqual(['c_a']);
    });
  });

  describe('remove', () => {
    it('reports deleted:true when a row actually existed', async () => {
      mockedPrisma.companySsoProvider.deleteMany.mockResolvedValue({ count: 1 });
      await expect(service.remove(COMPANY_ID)).resolves.toEqual({ deleted: true });
    });

    it('reports deleted:false — not an error — when there was nothing to remove', async () => {
      mockedPrisma.companySsoProvider.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.remove(COMPANY_ID)).resolves.toEqual({ deleted: false });
    });
  });

  describe('listDomains', () => {
    it('is empty — not an error — for a company with no provider row at all', async () => {
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(null);
      await expect(service.listDomains(COMPANY_ID)).resolves.toEqual([]);
    });

    it('maps every claimed domain to its status, verified or not', async () => {
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue({
        domains: [
          domainRow({ id: 'd1', domain: 'acme.com', verifiedAt: new Date() }),
          domainRow({ id: 'd2', domain: 'acme.fr', verifiedAt: null }),
        ],
      });

      const domains = await service.listDomains(COMPANY_ID);

      expect(domains).toEqual([
        {
          id: 'd1',
          domain: 'acme.com',
          verified: true,
          recordName: '_invoicerr-sso.acme.com',
          recordValue: 'invoicerr-sso-verification=a-verification-token',
        },
        {
          id: 'd2',
          domain: 'acme.fr',
          verified: false,
          recordName: '_invoicerr-sso.acme.fr',
          recordValue: 'invoicerr-sso-verification=a-verification-token',
        },
      ]);
    });
  });

  describe('addDomain', () => {
    it('refuses an invalid domain rather than storing junk', async () => {
      await expect(service.addDomain(COMPANY_ID, 'not a domain')).rejects.toBeInstanceOf(BadRequestException);
      expect(mockedPrisma.companySsoProvider.findUnique).not.toHaveBeenCalled();
    });

    it('refuses to claim a domain before an SSO provider is configured', async () => {
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(null);
      await expect(service.addDomain(COMPANY_ID, 'acme.com')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('claims a brand-new domain with a fresh token', async () => {
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(row());
      mockedPrisma.companySsoDomain.findUnique.mockResolvedValue(null);
      mockedPrisma.companySsoDomain.upsert.mockImplementation(async ({ create }) => domainRow(create));

      const status = await service.addDomain(COMPANY_ID, ' @Acme.COM ');

      expect(status.domain).toBe('acme.com');
      expect(status.verified).toBe(false);
      expect(mockedPrisma.companySsoDomain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerId_domain: { providerId: row().id, domain: 'acme.com' } },
        }),
      );
    });

    it('re-mints the token for an existing UNVERIFIED domain rather than erroring', async () => {
      const stale = domainRow({ token: 'stale-token', verifiedAt: null });
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(row());
      mockedPrisma.companySsoDomain.findUnique.mockResolvedValue(stale);
      mockedPrisma.companySsoDomain.upsert.mockImplementation(async ({ update }) =>
        domainRow({ ...stale, token: update.token }),
      );

      const status = await service.addDomain(COMPANY_ID, 'acme.com');

      expect(mockedPrisma.companySsoDomain.upsert).toHaveBeenCalled();
      expect(status.recordValue).not.toContain('stale-token');
    });

    it('leaves an already-VERIFIED domain untouched — re-adding it must never reset its token', async () => {
      // If this re-minted the token, the caller's DNS zone would still carry the OLD value: the domain
      // would silently stop being able to re-prove itself even though the settings screen still shows
      // it as verified, until someone happens to re-publish the new one.
      const verified = domainRow({ verifiedAt: new Date('2026-01-01T00:00:00Z') });
      mockedPrisma.companySsoProvider.findUnique.mockResolvedValue(row());
      mockedPrisma.companySsoDomain.findUnique.mockResolvedValue(verified);

      const status = await service.addDomain(COMPANY_ID, 'acme.com');

      expect(mockedPrisma.companySsoDomain.upsert).not.toHaveBeenCalled();
      expect(status.verified).toBe(true);
    });
  });

  describe('removeDomain', () => {
    it('scopes the delete through the provider relation, never a bare id', async () => {
      mockedPrisma.companySsoDomain.deleteMany.mockResolvedValue({ count: 1 });
      await service.removeDomain(COMPANY_ID, 'domain-1');
      expect(mockedPrisma.companySsoDomain.deleteMany).toHaveBeenCalledWith({
        where: { id: 'domain-1', provider: { companyId: COMPANY_ID } },
      });
    });

    it('reports deleted:false — not an error — for an id that does not belong to this company', async () => {
      mockedPrisma.companySsoDomain.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.removeDomain(COMPANY_ID, 'someone-elses-claim')).resolves.toEqual({
        deleted: false,
      });
    });
  });

  describe('verifyDomain — the DNS TXT challenge', () => {
    const recordValue = 'invoicerr-sso-verification=a-verification-token';

    it('throws NotFound for a claim id that does not belong to this company', async () => {
      mockedPrisma.companySsoDomain.findFirst.mockResolvedValue(null);
      await expect(service.verifyDomain(COMPANY_ID, 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(resolveTxt).not.toHaveBeenCalled();
    });

    it('is idempotent — an already-verified claim short-circuits without a DNS round-trip', async () => {
      mockedPrisma.companySsoDomain.findFirst.mockResolvedValue(domainRow({ verifiedAt: new Date() }));
      const status = await service.verifyDomain(COMPANY_ID, 'domain-1');
      expect(status.verified).toBe(true);
      expect(resolveTxt).not.toHaveBeenCalled();
    });

    it('turns ENOTFOUND into an actionable 400, naming the record to publish — never a 500', async () => {
      mockedPrisma.companySsoDomain.findFirst.mockResolvedValue(domainRow());
      resolveTxt.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));

      await expect(service.verifyDomain(COMPANY_ID, 'domain-1')).rejects.toThrow(/_invoicerr-sso\.acme\.com/);
    });

    it('treats ENODATA the same way as ENOTFOUND — no record published yet, not a server error', async () => {
      mockedPrisma.companySsoDomain.findFirst.mockResolvedValue(domainRow());
      resolveTxt.mockRejectedValue(Object.assign(new Error('no data'), { code: 'ENODATA' }));
      await expect(service.verifyDomain(COMPANY_ID, 'domain-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('a different DNS failure is STILL a failure to verify, never treated as a pass', async () => {
      mockedPrisma.companySsoDomain.findFirst.mockResolvedValue(domainRow());
      resolveTxt.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' }));
      await expect(service.verifyDomain(COMPANY_ID, 'domain-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when the TXT record exists but carries the wrong value', async () => {
      mockedPrisma.companySsoDomain.findFirst.mockResolvedValue(domainRow());
      resolveTxt.mockResolvedValue([['some-other-value']]);
      await expect(service.verifyDomain(COMPANY_ID, 'domain-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a record split across several chunks — the documented dns.resolveTxt shape', async () => {
      mockedPrisma.companySsoDomain.findFirst
        .mockResolvedValueOnce(domainRow()) // the claim lookup
        .mockResolvedValueOnce(null); // the in-transaction conflict check: nobody else holds it
      resolveTxt.mockResolvedValue([[recordValue.slice(0, 10), recordValue.slice(10)]]);

      const status = await service.verifyDomain(COMPANY_ID, 'domain-1');

      expect(status.verified).toBe(true);
      expect(mockedPrisma.companySsoDomain.update).toHaveBeenCalledWith({
        where: { id: 'domain-1' },
        data: { verifiedAt: expect.any(Date) },
      });
    });

    it('writes verifiedAt when the record matches and nobody else holds the domain', async () => {
      mockedPrisma.companySsoDomain.findFirst.mockResolvedValueOnce(domainRow()).mockResolvedValueOnce(null);
      resolveTxt.mockResolvedValue([[recordValue]]);

      const status = await service.verifyDomain(COMPANY_ID, 'domain-1');

      expect(status.verified).toBe(true);
      expect(mockedPrisma.companySsoDomain.update).toHaveBeenCalledWith({
        where: { id: 'domain-1' },
        data: { verifiedAt: expect.any(Date) },
      });
    });

    it('refuses with 409 when another provider already holds this domain VERIFIED — first wins', async () => {
      // THE SECURITY PROPERTY: a domain proven for one company must never ALSO end up verified for a
      // different one — resolveSsoLookup has no way to arbitrate between two "authoritative" rows for
      // the same domain, and matching the wrong one is exactly the credential-phishing primitive this
      // whole feature exists to prevent.
      mockedPrisma.companySsoDomain.findFirst
        .mockResolvedValueOnce(domainRow({ id: 'domain-2', providerId: 'other-provider-row' })) // claim
        .mockResolvedValueOnce(domainRow({ id: 'domain-1', providerId: 'row-1' })); // conflict: SOMEONE ELSE already verified
      resolveTxt.mockResolvedValue([[recordValue]]);

      await expect(service.verifyDomain(COMPANY_ID, 'domain-2')).rejects.toBeInstanceOf(ConflictException);
      expect(mockedPrisma.companySsoDomain.update).not.toHaveBeenCalled();

      // THE MUTATION PROOF this test used to be missing: `mockResolvedValueOnce` chains return their
      // queued value no matter what the mock was actually called with, so without this assertion a
      // regression that mis-scoped the SECOND `findFirst` (e.g. adding `providerId: claim.providerId`
      // to its `where`, which would make the conflict check only ever look at the CALLER'S OWN
      // provider and therefore never detect another company holding the domain) would leave this test
      // green. Pinning the exact `where` of call #2 is what makes it catch that regression.
      expect(mockedPrisma.companySsoDomain.findFirst).toHaveBeenNthCalledWith(2, {
        where: { domain: 'acme.com', verifiedAt: { not: null }, NOT: { id: 'domain-2' } },
      });
    });

    it('the 409 message names only the domain, never the other company', async () => {
      mockedPrisma.companySsoDomain.findFirst
        .mockResolvedValueOnce(domainRow({ id: 'domain-2' }))
        .mockResolvedValueOnce(domainRow({ id: 'domain-1' }));
      resolveTxt.mockResolvedValue([[recordValue]]);

      let caught: unknown;
      try {
        await service.verifyDomain(COMPANY_ID, 'domain-2');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as Error).message).not.toContain(COMPANY_ID);
      expect((caught as Error).message).toContain('acme.com');

      // Same mutation proof as the test above: assert the SECOND findFirst's actual arguments rather
      // than trusting call order alone to mean the right query ran.
      expect(mockedPrisma.companySsoDomain.findFirst).toHaveBeenNthCalledWith(2, {
        where: { domain: 'acme.com', verifiedAt: { not: null }, NOT: { id: 'domain-2' } },
      });
    });
  });
});
