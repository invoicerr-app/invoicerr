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

import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { encryptJson } from '@/utils/secret-crypto';
import { SsoService } from './sso.service';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySsoProvider: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  companySsoProvider: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
};

const COMPANY_ID = 'clx3k2j1p0000qwer1234asdf';
const PROVIDER_ID = `c_${COMPANY_ID}`;

/** A stored row, shaped exactly as Prisma would return it. */
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
  emailDomains: ['acme.com'],
  domainsVerifiedAt: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const VALID_BODY = {
  label: 'Acme SSO',
  discoveryUrl: 'https://idp.acme.com/.well-known/openid-configuration',
  clientId: 'acme-client',
  clientSecret: 'acme-secret',
  emailDomains: ['acme.com'],
};

describe('SsoService', () => {
  let service: SsoService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SsoService();
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
        'domainsVerified',
        'emailDomains',
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

    it('NEVER writes domainsVerifiedAt — not even null — so a future verification cannot be undone', async () => {
      // THE MUTATION PROOF for the domain-claim hole: a write that set this column would make every
      // typed-in domain instantly authoritative, which is exactly what must not be possible.
      mockedPrisma.companySsoProvider.upsert.mockImplementation(async ({ create }) =>
        row({ credentials: create.credentials }),
      );

      await service.upsert(COMPANY_ID, VALID_BODY);

      const { create, update } = mockedPrisma.companySsoProvider.upsert.mock.calls[0][0];
      expect(Object.keys(create)).not.toContain('domainsVerifiedAt');
      expect(Object.keys(update)).not.toContain('domainsVerifiedAt');
    });

    it('normalises the claimed domains rather than storing what was typed', async () => {
      mockedPrisma.companySsoProvider.upsert.mockImplementation(async ({ create }) =>
        row({ credentials: create.credentials }),
      );
      await service.upsert(COMPANY_ID, { ...VALID_BODY, emailDomains: ' @Acme.COM , acme.fr ' });
      expect(mockedPrisma.companySsoProvider.upsert.mock.calls[0][0].create.emailDomains).toEqual([
        'acme.com',
        'acme.fr',
      ]);
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
    it('returns ONLY providerId and label for an active row with VERIFIED domains', async () => {
      mockedPrisma.companySsoProvider.findMany.mockResolvedValue([
        {
          companyId: COMPANY_ID,
          label: 'Acme SSO',
          emailDomains: ['acme.com'],
          isActive: true,
          domainsVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);

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
      // declines — which is why this endpoint matches nothing at all until a verification challenge
      // exists. Deliberate: honouring an unverified claim would let any company type "gmail.com".
      mockedPrisma.companySsoProvider.findMany.mockResolvedValue([
        {
          companyId: COMPANY_ID,
          label: 'Acme SSO',
          emailDomains: ['acme.com'],
          isActive: true,
          domainsVerifiedAt: null,
        },
      ]);
      await expect(service.lookupByEmail('alice@acme.com')).resolves.toBeNull();
    });

    it('asks the database only for ACTIVE rows claiming that exact domain', async () => {
      mockedPrisma.companySsoProvider.findMany.mockResolvedValue([]);
      await service.lookupByEmail('alice@acme.com');
      expect(mockedPrisma.companySsoProvider.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true, emailDomains: { has: 'acme.com' } } }),
      );
    });

    it('never selects the credentials column at all on the anonymous path', async () => {
      mockedPrisma.companySsoProvider.findMany.mockResolvedValue([]);
      await service.lookupByEmail('alice@acme.com');
      const { select } = mockedPrisma.companySsoProvider.findMany.mock.calls[0][0];
      expect(Object.keys(select)).not.toContain('credentials');
    });

    it.each(['', '   ', 'not-an-email'])('is null for the non-address %p without querying', async (email) => {
      mockedPrisma.companySsoProvider.findMany.mockResolvedValue([]);
      await expect(service.lookupByEmail(email)).resolves.toBeNull();
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
});
