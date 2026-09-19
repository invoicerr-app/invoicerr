/**
 * `CompaniesService` constructed directly (`CompanyService` isn't touched by `leaveCompany`, so a
 * bare `{} as never` stands in for it — same "construct the service directly" shape
 * `transfer.service.spec.ts` uses), real Prisma against whatever `DATABASE_URL` this test run
 * resolves ("invoicerr_dev" in this repo's own dev setup — jest never loads `.env.test`).
 */
import { randomUUID } from 'node:crypto';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { CompaniesService, LAST_OWNER_CANNOT_LEAVE_CODE } from './companies.service';

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
  const service = new CompaniesService({} as never);

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
