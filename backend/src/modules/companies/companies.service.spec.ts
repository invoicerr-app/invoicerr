/**
 * `CompaniesService` constructed directly (`CompanyService` isn't touched by `leaveCompany`, so a
 * bare `{} as never` stands in for it — same "construct the service directly" shape
 * `transfer.service.spec.ts` uses), real Prisma against whatever `DATABASE_URL` this test run
 * resolves ("invoicerr_dev" in this repo's own dev setup — jest never loads `.env.test`).
 */
import { randomUUID } from 'node:crypto';

import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

import { BillingExportService } from '@/modules/billing/export-zip.service';
import { MailService } from '@/mail/mail.service';
import prisma from '@/prisma/prisma.service';

import {
  CompaniesService,
  LAST_OWNER_CANNOT_LEAVE_CODE,
  SELF_SERVICE_EXPORT_COOLDOWN_MINUTES,
  SELF_SERVICE_EXPORT_RATE_LIMITED_CODE,
  SELF_SERVICE_EXPORT_STREAM_THRESHOLD_BYTES,
} from './companies.service';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function createUser() {
  return prisma.user.create({
    data: { id: randomUUID(), firstname: 'Test', lastname: 'User', email: uniqueEmail('user') },
  });
}

async function createCompany() {
  return prisma.company.create({
    data: {
      name: `Leave Test Co ${randomUUID()}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: uniqueEmail('company'),
    },
  });
}

async function cleanup(companyId: string, userIds: string[]) {
  await prisma.userCompany.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describe('CompaniesService#leaveCompany', () => {
  const service = new CompaniesService({} as never, {} as never, {} as never);

  it("removes a MEMBER's own membership — no owner check applies to a non-owner", async () => {
    const owner = await createUser();
    const member = await createUser();
    const company = await createCompany();
    await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
    await prisma.userCompany.create({ data: { userId: member.id, companyId: company.id, role: 'MEMBER' } });

    try {
      const result = await service.leaveCompany(company.id, member.id);
      expect(result).toEqual({ success: true });

      const membership = await prisma.userCompany.findUnique({
        where: { userId_companyId: { userId: member.id, companyId: company.id } },
      });
      expect(membership).toBeNull();

      // The other membership (and the company itself) survive untouched.
      const ownerMembership = await prisma.userCompany.findUnique({
        where: { userId_companyId: { userId: owner.id, companyId: company.id } },
      });
      expect(ownerMembership).not.toBeNull();
    } finally {
      await cleanup(company.id, [owner.id, member.id]);
    }
  });

  it('lets an OWNER leave when at least one other OWNER remains', async () => {
    const ownerA = await createUser();
    const ownerB = await createUser();
    const company = await createCompany();
    await prisma.userCompany.create({ data: { userId: ownerA.id, companyId: company.id, role: 'OWNER' } });
    await prisma.userCompany.create({ data: { userId: ownerB.id, companyId: company.id, role: 'OWNER' } });

    try {
      await expect(service.leaveCompany(company.id, ownerA.id)).resolves.toEqual({ success: true });

      const remaining = await prisma.userCompany.findMany({ where: { companyId: company.id } });
      expect(remaining.map((m) => m.userId)).toEqual([ownerB.id]);
    } finally {
      await cleanup(company.id, [ownerA.id, ownerB.id]);
    }
  });

  it('refuses to let the LAST owner leave, with a distinct code pointing at ownership transfer', async () => {
    const owner = await createUser();
    const company = await createCompany();
    await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });

    try {
      let caught: unknown;
      try {
        await service.leaveCompany(company.id, owner.id);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).getResponse()).toMatchObject({
        code: LAST_OWNER_CANNOT_LEAVE_CODE,
      });

      // The membership was never touched by the refused attempt.
      const membership = await prisma.userCompany.findUnique({
        where: { userId_companyId: { userId: owner.id, companyId: company.id } },
      });
      expect(membership).not.toBeNull();
    } finally {
      await cleanup(company.id, [owner.id]);
    }
  });

  it('refuses for a caller who is not actually a member of the company', async () => {
    const stranger = await createUser();
    const company = await createCompany();

    try {
      await expect(service.leaveCompany(company.id, stranger.id)).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      await cleanup(company.id, [stranger.id]);
    }
  });
});

function fakeExportService(zip: Buffer) {
  return { buildCompanyZip: jest.fn().mockResolvedValue(zip) } as unknown as BillingExportService;
}

function fakeMailService(sendForCompany = jest.fn().mockResolvedValue({ message: 'ok' })) {
  return { sendForCompany } as unknown as MailService;
}

describe('CompaniesService#exportCompanyData', () => {
  it('streams the zip directly back when it is at or under the streaming threshold', async () => {
    const company = await createCompany();
    const zip = Buffer.alloc(SELF_SERVICE_EXPORT_STREAM_THRESHOLD_BYTES, 1);
    const exportService = fakeExportService(zip);
    const service = new CompaniesService({} as never, exportService, fakeMailService());

    try {
      const result = await service.exportCompanyData(company.id, 'owner@example.com');
      // `toBe`, not `toEqual` — the service never copies the buffer it got back from
      // `buildCompanyZip`, and a deep `toEqual` over a multi-megabyte `Buffer` is needlessly slow.
      expect(result).toMatchObject({ mode: 'stream' });
      expect((result as { zip: Buffer }).zip).toBe(zip);
      expect(exportService.buildCompanyZip).toHaveBeenCalledWith(company.id);
    } finally {
      await cleanup(company.id, []);
    }
  });

  it('emails the export to the caller instead once it exceeds the streaming threshold', async () => {
    const company = await createCompany();
    const zip = Buffer.alloc(SELF_SERVICE_EXPORT_STREAM_THRESHOLD_BYTES + 1, 1);
    const sendForCompany = jest.fn().mockResolvedValue({ message: 'ok' });
    const service = new CompaniesService(
      {} as never,
      fakeExportService(zip),
      fakeMailService(sendForCompany),
    );

    try {
      const result = await service.exportCompanyData(company.id, 'owner@example.com');
      expect(result).toEqual({ mode: 'emailed', to: 'owner@example.com' });
      expect(sendForCompany).toHaveBeenCalledWith(
        company.id,
        expect.objectContaining({
          to: 'owner@example.com',
          attachments: [expect.objectContaining({ filename: 'invoicerr-export.zip' })],
        }),
      );
    } finally {
      await cleanup(company.id, []);
    }
  });

  it('refuses a second export of the SAME company inside the cooldown window, with a named 429', async () => {
    const company = await createCompany();
    const zip = Buffer.alloc(1);
    const service = new CompaniesService({} as never, fakeExportService(zip), fakeMailService());

    try {
      await expect(service.exportCompanyData(company.id, 'owner@example.com')).resolves.toMatchObject({
        mode: 'stream',
      });

      let caught: unknown;
      try {
        await service.exportCompanyData(company.id, 'owner@example.com');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect((caught as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((caught as HttpException).getResponse()).toMatchObject({
        code: SELF_SERVICE_EXPORT_RATE_LIMITED_CODE,
      });
    } finally {
      await cleanup(company.id, []);
    }
  });

  it('two truly concurrent requests for the SAME company never both win the cooldown slot (double-click)', async () => {
    // The sequential test above only proves the SECOND call sees the first one's write — it says
    // nothing about two requests racing each other with neither's `updateMany` yet committed when the
    // other starts, exactly what an impatient double click on the export button produces. The `WHERE
    // lastSelfServiceExportAt IS NULL OR < cutoff` compare-and-set is what `claimExportSlot`'s own
    // header claims makes that safe — this fires both calls with no `await` between them to actually
    // exercise that guarantee against a real database, not just against Jest's own event loop
    // ordering.
    const company = await createCompany();
    const service = new CompaniesService({} as never, fakeExportService(Buffer.alloc(1)), fakeMailService());

    try {
      const results = await Promise.allSettled([
        service.exportCompanyData(company.id, 'owner@example.com'),
        service.exportCompanyData(company.id, 'owner@example.com'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(HttpException);
      expect(((rejected[0] as PromiseRejectedResult).reason as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    } finally {
      await cleanup(company.id, []);
    }
  });

  it('never builds the zip at all when the cooldown refuses the request (claimed BEFORE the build)', async () => {
    const company = await createCompany();
    await prisma.company.update({ where: { id: company.id }, data: { lastSelfServiceExportAt: new Date() } });
    const exportService = fakeExportService(Buffer.alloc(1));
    const service = new CompaniesService({} as never, exportService, fakeMailService());

    try {
      await expect(service.exportCompanyData(company.id, 'owner@example.com')).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(exportService.buildCompanyZip).not.toHaveBeenCalled();
    } finally {
      await cleanup(company.id, []);
    }
  });

  it('allows a new export once the cooldown window has fully elapsed', async () => {
    const company = await createCompany();
    const longAgo = new Date(Date.now() - (SELF_SERVICE_EXPORT_COOLDOWN_MINUTES + 1) * 60_000);
    await prisma.company.update({ where: { id: company.id }, data: { lastSelfServiceExportAt: longAgo } });
    const service = new CompaniesService({} as never, fakeExportService(Buffer.alloc(1)), fakeMailService());

    try {
      await expect(service.exportCompanyData(company.id, 'owner@example.com')).resolves.toMatchObject({
        mode: 'stream',
      });
    } finally {
      await cleanup(company.id, []);
    }
  });

  it("never touches a DIFFERENT company's own cooldown", async () => {
    const companyA = await createCompany();
    const companyB = await createCompany();
    const service = new CompaniesService({} as never, fakeExportService(Buffer.alloc(1)), fakeMailService());

    try {
      await expect(service.exportCompanyData(companyA.id, 'owner@example.com')).resolves.toMatchObject({
        mode: 'stream',
      });
      // B was never claimed by A's own export — it should still be free.
      await expect(service.exportCompanyData(companyB.id, 'owner@example.com')).resolves.toMatchObject({
        mode: 'stream',
      });
    } finally {
      await cleanup(companyA.id, []);
      await cleanup(companyB.id, []);
    }
  });
});
