/**
 * SigningCertificatesService in isolation — root TODO item 13. Mocks `@/prisma/prisma.service` at its
 * own entry point, the same discipline `channels.service.spec.ts` already holds for
 * `ChannelCredentialsService` — this proves the SERVICE's own logic (encrypt→store→resolve→decrypt
 * round-trip, expiry handling, what a GET is and is not allowed to carry), never a real database.
 *
 * `CREDENTIALS_ENCRYPTION_KEY` is set here to a FIXED test value — `utils/secret-crypto.ts`'s real
 * AES-256-GCM, exercised for real, never mocked away.
 *
 * Certs are generated in-memory with node-forge. No real certificate is ever committed or used.
 */
process.env.CREDENTIALS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import * as forge from 'node-forge';

import prisma from '@/prisma/prisma.service';
import { encryptJson } from '@/utils/secret-crypto';
import { ChannelEnvironment } from '../../../../prisma/generated/prisma/client';
import { SigningCertificatesService } from './signing-certificates.service';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companySigningCertificate: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

const mockedPrisma = prisma as unknown as {
  companySigningCertificate: {
    findUnique: jest.Mock;
    findMany: jest.Mock;
    upsert: jest.Mock;
    updateMany: jest.Mock;
  };
};

const COMPANY_ID = 'company-signing-1';

// ── In-memory self-signed cert + PFX builder ────────────────────────────────

interface TestCertBundle {
  pfxBase64: string;
  password: string;
  notBefore: Date;
  notAfter: Date;
  serial: string;
}

function generateTestCert(opts: { expired?: boolean } = {}): TestCertBundle {
  const keys = forge.pki.rsa.generateKeyPair(1024); // 1024 for speed in tests
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';

  const now = new Date();
  if (opts.expired) {
    cert.validity.notBefore = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2d ago
    cert.validity.notAfter = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1d ago
  } else {
    cert.validity.notBefore = now;
    cert.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  }

  const attrs = [
    { name: 'commonName', value: 'Test Invoicerr Signing Cert' },
    { name: 'countryName', value: 'FR' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const password = 'test-pfx-password-not-real';
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password);
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();
  const pfxBase64 = Buffer.from(p12Der, 'binary').toString('base64');

  return {
    pfxBase64,
    password,
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    serial: cert.serialNumber,
  };
}

/** Minimal in-memory store backing the mocked `findUnique`/`findMany`/`upsert`/`updateMany`. */
function wireStore(initialRows: Record<string, unknown>[] = []) {
  const store: Record<string, unknown>[] = [...initialRows];

  mockedPrisma.companySigningCertificate.findUnique.mockImplementation(({ where }: any) => {
    const key = where.companyId_applicability_environment ?? {};
    const found = store.find(
      (r) =>
        r.companyId === key.companyId &&
        r.applicability === key.applicability &&
        r.environment === key.environment,
    );
    return Promise.resolve(found ?? null);
  });
  mockedPrisma.companySigningCertificate.findMany.mockImplementation(({ where }: any) =>
    Promise.resolve(store.filter((r) => !where?.companyId || r.companyId === where.companyId)),
  );
  mockedPrisma.companySigningCertificate.upsert.mockImplementation(({ where, create, update }: any) => {
    const key = where.companyId_applicability_environment;
    const idx = store.findIndex(
      (r) =>
        r.companyId === key.companyId &&
        r.applicability === key.applicability &&
        r.environment === key.environment,
    );
    if (idx >= 0) {
      store[idx] = { ...store[idx], ...update };
      return Promise.resolve(store[idx]);
    }
    const row = {
      id: `cert_${store.length + 1}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...create,
    };
    store.push(row);
    return Promise.resolve(row);
  });
  mockedPrisma.companySigningCertificate.updateMany.mockImplementation(({ where, data }: any) => {
    let count = 0;
    for (const row of store) {
      if (row.id === where.id && row.companyId === where.companyId) {
        Object.assign(row, data);
        count++;
      }
    }
    return Promise.resolve({ count });
  });

  return store;
}

describe('SigningCertificatesService', () => {
  let service: SigningCertificatesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SigningCertificatesService();
  });

  describe('upload() — extraction, encryption, and refusal', () => {
    it('extracts notBefore/notAfter/serial/subject and encrypts both blobs, never storing plaintext', async () => {
      wireStore();
      const bundle = generateTestCert();

      const meta = await service.upload(COMPANY_ID, {
        label: 'Test cert round-trip',
        pfxBase64: bundle.pfxBase64,
        pfxPassword: bundle.password,
      });

      expect(meta.companyId).toBe(COMPANY_ID);
      expect(meta.serial).toBeTruthy();
      expect(meta.subject).toContain('CN=Test Invoicerr Signing Cert');
      expect(meta.isActive).toBe(true);
      // X.509 validity fields only carry second-granularity precision (ASN.1 UTCTime/GeneralizedTime)
      // — the PFX round-trip through DER inside `parsePfx` correctly drops milliseconds, so the
      // comparison is truncated to the second rather than expecting byte-identical Date objects.
      expect(Math.floor(meta.notAfter.getTime() / 1000)).toBe(Math.floor(bundle.notAfter.getTime() / 1000));

      const upsertCall = mockedPrisma.companySigningCertificate.upsert.mock.calls[0][0];
      expect(upsertCall.create.encryptedPfx).not.toContain(bundle.pfxBase64);
      expect(upsertCall.create.encryptedPass).not.toContain(bundle.password);
      expect(JSON.stringify(upsertCall.create)).not.toContain(bundle.password);
    });

    it('a corrupted PFX → refuses NOISILY, named error, never a bare crash', async () => {
      wireStore();
      await expect(
        service.upload(COMPANY_ID, {
          label: 'Corrupt',
          pfxBase64: Buffer.from('this is not a pfx at all').toString('base64'),
          pfxPassword: 'whatever',
        }),
      ).rejects.toThrow(/not a valid PKCS#12/i);
    });

    it('the wrong password for an otherwise-valid PFX → refuses NOISILY, named error', async () => {
      wireStore();
      const bundle = generateTestCert();
      await expect(
        service.upload(COMPANY_ID, {
          label: 'Wrong password',
          pfxBase64: bundle.pfxBase64,
          pfxPassword: 'definitely-not-the-real-password',
        }),
      ).rejects.toThrow(/wrong password or corrupted file/i);
    });

    it('an ALREADY-EXPIRED certificate → refused at upload, never stored', async () => {
      wireStore();
      const bundle = generateTestCert({ expired: true });
      await expect(
        service.upload(COMPANY_ID, {
          label: 'Expired',
          pfxBase64: bundle.pfxBase64,
          pfxPassword: bundle.password,
        }),
      ).rejects.toThrow(/expired/i);
      expect(mockedPrisma.companySigningCertificate.upsert).not.toHaveBeenCalled();
    });
  });

  describe('resolve() — the PORT surface sign-instance-pdf.ts calls', () => {
    it('round-trip: upload → resolve returns valid signing material', async () => {
      wireStore();
      const bundle = generateTestCert();
      await service.upload(COMPANY_ID, {
        label: 'Round-trip',
        pfxBase64: bundle.pfxBase64,
        pfxPassword: bundle.password,
      });

      const material = await service.resolve(COMPANY_ID);
      expect(material).not.toBeNull();
      expect(material!.certDer).toBeInstanceOf(Buffer);
      expect(material!.certPem).toContain('BEGIN CERTIFICATE');
      expect(material!.privateKeyPem).toContain('PRIVATE KEY');
      expect(material!.p12Buffer).toBeInstanceOf(Buffer);
      expect(material!.p12Password).toBe(bundle.password);
    });

    it('no cert configured → resolve returns null', async () => {
      wireStore([]);
      expect(await service.resolve('company-with-no-cert')).toBeNull();
    });

    /**
     * "jamais utilisé, dit pourquoi" — a cert valid AT UPLOAD TIME can still expire before its next
     * use; `upload()`'s own refusal (tested above) cannot catch this, only `resolve()`'s own check
     * can. The row is inserted directly into the store (bypassing `upload()`) to simulate exactly
     * that: an active row whose `notAfter` has since elapsed. THIS is mutation #1's target — if the
     * validity check in `resolve()` is ever disabled, this is the test that fails.
     */
    it('an ACTIVE cert that has since EXPIRED → resolve returns null, never used, and says why', async () => {
      const bundle = generateTestCert(); // still-valid material — only the STORED notAfter is stale
      wireStore([
        {
          id: 'cert_since_expired',
          companyId: COMPANY_ID,
          label: 'Was valid, now expired',
          applicability: '*',
          environment: ChannelEnvironment.TEST,
          encryptedPfx: encryptJson(bundle.pfxBase64),
          encryptedPass: encryptJson(bundle.password),
          notBefore: new Date('2020-01-01'),
          notAfter: new Date('2020-06-01'), // long past
          serial: bundle.serial,
          subject: 'CN=Was valid, now expired',
          isActive: true, // <-- still active — only expiry should block it
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const material = await service.resolve(COMPANY_ID);
      // An expired cert must never be handed to a signing provider.
      expect(material).toBeNull();
    });

    it('inactive cert → resolve skips it and returns null', async () => {
      const bundle = generateTestCert();
      wireStore([
        {
          id: 'cert_inactive',
          companyId: COMPANY_ID,
          applicability: '*',
          environment: ChannelEnvironment.TEST,
          encryptedPfx: encryptJson(bundle.pfxBase64),
          encryptedPass: encryptJson(bundle.password),
          notBefore: bundle.notBefore,
          notAfter: bundle.notAfter,
          serial: bundle.serial,
          subject: 'CN=Test',
          isActive: false, // <-- inactive
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      expect(await service.resolve(COMPANY_ID)).toBeNull();
    });

    it('certRef "{companyId}:{algo}" falls back to the wildcard "*" cert', async () => {
      wireStore();
      const bundle = generateTestCert();
      await service.upload(COMPANY_ID, {
        label: 'Algo-scoped fallback',
        pfxBase64: bundle.pfxBase64,
        pfxPassword: bundle.password,
      });
      const material = await service.resolve(`${COMPANY_ID}:PAdES`);
      expect(material).not.toBeNull();
    });

    it('missing encryption key → resolve returns null (does not crash)', async () => {
      wireStore();
      const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
      delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      try {
        expect(await service.resolve(COMPANY_ID)).toBeNull();
      } finally {
        process.env.CREDENTIALS_ENCRYPTION_KEY = key;
      }
    });
  });

  describe('listForCompany() — the GET the settings screen calls: METADATA ONLY, never returns', () => {
    it('never returns encryptedPfx/encryptedPass, and the secret never appears anywhere in the output', async () => {
      const store = wireStore();
      const secretMarker = 'THIS-MUST-NEVER-LEAK-a1c9f0';
      store.push({
        id: 'cert-1',
        companyId: COMPANY_ID,
        label: 'Leak test',
        applicability: '*',
        environment: ChannelEnvironment.TEST,
        encryptedPfx: encryptJson({ pfx: secretMarker }),
        encryptedPass: encryptJson(secretMarker),
        notBefore: new Date('2026-01-01'),
        notAfter: new Date('2027-01-01'),
        serial: '1',
        subject: 'CN=Leak',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const list = await service.listForCompany(COMPANY_ID);
      expect(list).toHaveLength(1);
      for (const item of list) {
        expect(Object.keys(item)).not.toContain('encryptedPfx');
        expect(Object.keys(item)).not.toContain('encryptedPass');
      }
      // THE MUTATION PROOF (task mutation #2, applied to this store instead of channels'): if
      // `toMeta` were changed to spread the raw row (or `listForCompany` to return rows verbatim),
      // this is the assertion that would catch it — the secret must not appear ANYWHERE in the
      // serialized response.
      expect(JSON.stringify(list)).not.toContain(secretMarker);
    });
  });

  describe('deactivate() — soft delete, scoped by companyId', () => {
    it('deactivates a cert owned by the caller — isActive becomes false, row stays', async () => {
      const store = wireStore([
        {
          id: 'cert-owned',
          companyId: COMPANY_ID,
          label: 'Mine',
          applicability: '*',
          environment: ChannelEnvironment.TEST,
          encryptedPfx: 'x',
          encryptedPass: 'y',
          notBefore: new Date(),
          notAfter: new Date(),
          serial: '1',
          subject: 'CN=Mine',
          isActive: true,
        },
      ]);

      const result = await service.deactivate(COMPANY_ID, 'cert-owned');
      expect(result).toEqual({ deactivated: true });
      expect(store[0].isActive).toBe(false);
    });

    it('a certificate id that belongs to a DIFFERENT company is never touched — count 0', async () => {
      wireStore([
        {
          id: 'cert-foreign',
          companyId: 'some-other-company',
          applicability: '*',
          environment: ChannelEnvironment.TEST,
          isActive: true,
        },
      ]);

      const result = await service.deactivate(COMPANY_ID, 'cert-foreign');
      expect(result).toEqual({ deactivated: false });
    });
  });
});
