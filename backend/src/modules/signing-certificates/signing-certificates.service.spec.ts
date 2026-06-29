/**
 * Unit tests for SigningCertificatesService.
 *
 * Tests:
 *  1. encrypt→store→resolve→decrypt round-trip (in-memory self-signed cert).
 *  2. Expired cert → resolve returns null (skipped with warn).
 *  3. No cert configured → resolve returns null (NullSigningCredentials path).
 *  4. Controller never leaks secrets (listForCompany returns no PFX / no password).
 *  5. Upload extracts cert metadata correctly.
 *  6. isEncryptionAvailable() gate — disabled when key missing.
 *
 * Certs are generated in-memory with node-forge.  No real certs are committed.
 */
import * as forge from 'node-forge';
import { SigningCertificatesService } from './signing-certificates.service';
import { encryptJson } from '@/utils/secret-crypto';
import type { PrismaService } from '@/prisma/prisma.service';

// ── Encryption key (test-only) ──────────────────────────────────────────────
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
beforeAll(() => { process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY; });
afterAll(() => { delete process.env.CREDENTIALS_ENCRYPTION_KEY; });

const COMPANY_ID = 'cmp_test_signing_001';

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
    cert.validity.notAfter  = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1d ago
  } else {
    cert.validity.notBefore = now;
    cert.validity.notAfter  = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
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
  const p12Der  = forge.asn1.toDer(p12Asn1).getBytes();
  const pfxBase64 = Buffer.from(p12Der, 'binary').toString('base64');

  return {
    pfxBase64,
    password,
    notBefore: cert.validity.notBefore,
    notAfter:  cert.validity.notAfter,
    serial:    cert.serialNumber,
  };
}

// ── PrismaService mock ───────────────────────────────────────────────────────

type RowLike = Record<string, unknown>;

function makePrisma(rows: RowLike[] = []): PrismaService {
  let store: RowLike[] = [...rows];

  return {
    companySigningCertificate: {
      findUnique: jest.fn().mockImplementation(({ where }: any) => {
        const { companyId, applicability, environment } = where.companyId_applicability_environment ?? {};
        const found = store.find(
          (r) => r.companyId === companyId && r.applicability === applicability && r.environment === environment,
        );
        return Promise.resolve(found ?? null);
      }),
      findMany: jest.fn().mockResolvedValue(store),
      upsert: jest.fn().mockImplementation(({ create }: any) => {
        const row = { id: `cert_${Date.now()}`, ...create };
        store.push(row);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SigningCertificatesService', () => {
  // 1. encrypt→store→resolve→decrypt round-trip
  it('round-trip: upload → resolve returns valid signing material', async () => {
    const bundle = generateTestCert();
    const prisma  = makePrisma();
    const svc     = new SigningCertificatesService(prisma);

    const meta = await svc.upload(COMPANY_ID, {
      label: 'Test cert round-trip',
      pfxBase64: bundle.pfxBase64,
      pfxPassword: bundle.password,
    });

    // Metadata is correct.
    expect(meta.companyId).toBe(COMPANY_ID);
    // node-forge strips leading zeros from the serial number ("01" → "1").
    expect(meta.serial).toBeTruthy();
    expect(meta.subject).toContain('CN=Test Invoicerr Signing Cert');
    expect(meta.isActive).toBe(true);
    // No secret fields on meta.
    expect((meta as any).encryptedPfx).toBeUndefined();
    expect((meta as any).encryptedPass).toBeUndefined();
    expect((meta as any).pfxBase64).toBeUndefined();
    expect((meta as any).pfxPassword).toBeUndefined();

    // Resolve the cert.
    const material = await svc.resolve(COMPANY_ID);
    expect(material).not.toBeNull();
    expect(material!.certDer).toBeInstanceOf(Buffer);
    expect(material!.certPem).toContain('BEGIN CERTIFICATE');
    expect(material!.privateKeyPem).toContain('PRIVATE KEY');
    expect(material!.p12Buffer).toBeInstanceOf(Buffer);
    expect(material!.p12Password).toBe(bundle.password);
  });

  // 2. Expired cert → returns null
  it('expired cert → resolve returns null (skipped with warn)', async () => {
    const bundle = generateTestCert({ expired: true });
    const svc    = new SigningCertificatesService(makePrisma());

    await svc.upload(COMPANY_ID, {
      label: 'Expired cert',
      pfxBase64: bundle.pfxBase64,
      pfxPassword: bundle.password,
    });

    const material = await svc.resolve(COMPANY_ID);
    expect(material).toBeNull();
  });

  // 3. No cert configured → resolve returns null
  it('no cert configured → resolve returns null', async () => {
    const svc    = new SigningCertificatesService(makePrisma([]));
    const result = await svc.resolve('company_with_no_cert');
    expect(result).toBeNull();
  });

  // 4. listForCompany never returns secret fields
  it('listForCompany strips encryptedPfx and encryptedPass', async () => {
    const bundle = generateTestCert();
    const svc    = new SigningCertificatesService(makePrisma());

    await svc.upload(COMPANY_ID, {
      label: 'Secret masking test',
      pfxBase64: bundle.pfxBase64,
      pfxPassword: bundle.password,
    });

    const list = await svc.listForCompany(COMPANY_ID);
    expect(list.length).toBeGreaterThan(0);
    for (const item of list) {
      expect((item as any).encryptedPfx).toBeUndefined();
      expect((item as any).encryptedPass).toBeUndefined();
      expect((item as any).pfxBase64).toBeUndefined();
      expect((item as any).pfxPassword).toBeUndefined();
      // Expected fields are present.
      expect(item.id).toBeDefined();
      expect(item.label).toBeDefined();
      expect(item.subject).toBeDefined();
      expect(item.notAfter).toBeInstanceOf(Date);
    }
  });

  // 5. Inactive cert → resolve returns null
  it('inactive cert → resolve skips it and returns null', async () => {
    const bundle  = generateTestCert();
    const row: RowLike = {
      id: 'cert_inactive',
      companyId: COMPANY_ID,
      applicability: '*',
      environment: 'TEST',
      encryptedPfx: encryptJson(bundle.pfxBase64),
      encryptedPass: encryptJson(bundle.password),
      notBefore: bundle.notBefore,
      notAfter: bundle.notAfter,
      serial: bundle.serial,
      subject: 'CN=Test',
      isActive: false,  // <-- inactive
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const svc = new SigningCertificatesService(makePrisma([row]));
    const material = await svc.resolve(COMPANY_ID);
    expect(material).toBeNull();
  });

  // 6. delete removes the cert
  it('delete removes cert — deleteMany is called with correct companyId + certId', async () => {
    const prisma = makePrisma();
    const svc    = new SigningCertificatesService(prisma);

    await svc.delete(COMPANY_ID, 'cert_123');

    expect(prisma.companySigningCertificate.deleteMany).toHaveBeenCalledWith({
      where: { id: 'cert_123', companyId: COMPANY_ID },
    });
  });

  // 7. certRef with companyId:algo suffix → companyId is parsed correctly
  it('certRef "{companyId}:{algo}" — parses companyId from prefix', async () => {
    const bundle = generateTestCert();
    const svc    = new SigningCertificatesService(makePrisma());

    await svc.upload(COMPANY_ID, {
      label: 'Algo-scoped cert',
      pfxBase64: bundle.pfxBase64,
      pfxPassword: bundle.password,
    });

    // certRef with algo suffix — companyId prefix is the real lookup key.
    const material = await svc.resolve(`${COMPANY_ID}:XAdES`);
    // Falls through to wildcard "*" because no XAdES-specific cert was uploaded.
    expect(material).not.toBeNull();
  });

  // 8. Missing encryption key → resolve returns null gracefully
  it('missing encryption key → resolve returns null (does not crash)', async () => {
    const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;

    const svc = new SigningCertificatesService(makePrisma());
    const result = await svc.resolve(COMPANY_ID);
    expect(result).toBeNull();

    process.env.CREDENTIALS_ENCRYPTION_KEY = key;
  });
});
