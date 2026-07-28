/**
 * IDOR regression — SigningCertificatesController used to trust `@Param('id')` for the
 * company being read/written, so any authenticated user (any company, any role) could
 * list, upload, or delete another tenant's signing certificate (the credential used to
 * sign that tenant's outbound e-invoices) just by putting that tenant's company id in the
 * URL. This is the most severe of the compliance-module IDORs: uploading a certificate for
 * a foreign company lets an attacker have their own PFX used to sign that company's
 * invoices going forward.
 *
 * The fix scopes every handler to `@ActiveCompany()` (the caller's session-derived active
 * company) and gates upload/delete behind `@Roles(OWNER, ADMIN)`.
 *
 * As in channel-credentials.controller.spec.ts, this boots the REAL controller behind the
 * REAL RolesGuard over actual HTTP, with a test-only middleware standing in for AuthGuard.
 */
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SigningCertificatesController } from './signing-certificates.controller';
import { SigningCertificatesService } from '@/modules/signing-certificates/signing-certificates.service';
import { RolesGuard } from '@/guards/roles.guard';
import { CompanyRole } from '../../../prisma/generated/prisma/client';

describe('SigningCertificatesController — cross-tenant IDOR regression', () => {
  let app: INestApplication;
  let baseUrl: string;

  const certs = {
    listForCompany: jest.fn(async (companyId: string) => [{ companyId }]),
    upload: jest.fn(async (companyId: string, body: unknown) => ({ companyId, ...(body as object) })),
    delete: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SigningCertificatesController],
      providers: [
        { provide: SigningCertificatesService, useValue: certs },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Stand-in for AuthGuard: populates request.companyId/role from test-only headers.
    app.use((req: any, _res: any, next: any) => {
      req.companyId = req.headers['x-test-company-id'] ?? null;
      req.role = req.headers['x-test-role'] ?? null;
      req.companies = [];
      next();
    });
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('a company-B MEMBER listing /companies/company-A only ever sees company B (session), never A (URL)', async () => {
    const res = await fetch(`${baseUrl}/compliance/signing-certificates/companies/company-A`, {
      headers: { 'x-test-company-id': 'company-B', 'x-test-role': CompanyRole.MEMBER },
    });
    expect(res.status).toBe(200);
    expect(certs.listForCompany).toHaveBeenCalledWith('company-B');
    expect(certs.listForCompany).not.toHaveBeenCalledWith('company-A');
  });

  it('a company-B MEMBER cannot upload a signing certificate at all (OWNER/ADMIN only) → 403', async () => {
    const res = await fetch(`${baseUrl}/compliance/signing-certificates/companies/company-A`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-company-id': 'company-B',
        'x-test-role': CompanyRole.MEMBER,
      },
      body: JSON.stringify({ label: 'evil cert', pfxBase64: 'AA==', pfxPassword: 'x' }),
    });
    expect(res.status).toBe(403);
    expect(certs.upload).not.toHaveBeenCalled();
  });

  it('a company-B OWNER uploading via /companies/company-A in the URL still only writes to company B', async () => {
    const res = await fetch(`${baseUrl}/compliance/signing-certificates/companies/company-A`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-company-id': 'company-B',
        'x-test-role': CompanyRole.OWNER,
      },
      body: JSON.stringify({ label: 'legit cert', pfxBase64: 'AA==', pfxPassword: 'x' }),
    });
    expect(res.status).toBe(201);
    expect(certs.upload).toHaveBeenCalledWith('company-B', expect.objectContaining({ label: 'legit cert' }));
    expect(certs.upload).not.toHaveBeenCalledWith('company-A', expect.anything());
  });

  it("a company-B MEMBER cannot delete company A's signing certificate → 403", async () => {
    const res = await fetch(`${baseUrl}/compliance/signing-certificates/companies/company-A/cert-1`, {
      method: 'DELETE',
      headers: { 'x-test-company-id': 'company-B', 'x-test-role': CompanyRole.MEMBER },
    });
    expect(res.status).toBe(403);
    expect(certs.delete).not.toHaveBeenCalled();
  });
});
