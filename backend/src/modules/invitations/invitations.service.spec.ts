import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { InvitationsService } from '@/modules/invitations/invitations.service';
import { PrismaService } from '@/prisma/prisma.service';

jest.mock('@/logger/logger.service', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: {
    invitationCode: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    userCompany: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    user: {
      count: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      invitationCode: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userCompany: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      user: {
        count: jest.fn(),
      },
    };
    service = new InvitationsService(prisma as unknown as PrismaService);
  });

  describe('createInvitation', () => {
    it('lets a non-owner create a MEMBER-role invitation', async () => {
      prisma.invitationCode.create.mockResolvedValue({
        id: 'inv1',
        code: 'CODE123',
        role: CompanyRole.MEMBER,
        createdAt: new Date(),
        expiresAt: null,
      });

      const result = await service.createInvitation('user1', 'company1', CompanyRole.MEMBER);

      expect(prisma.userCompany.findUnique).not.toHaveBeenCalled();
      expect(result.role).toBe(CompanyRole.MEMBER);
    });

    it('rejects a non-owner trying to create an OWNER-role invitation', async () => {
      prisma.userCompany.findUnique.mockResolvedValue({ role: CompanyRole.ADMIN });

      await expect(service.createInvitation('user1', 'company1', CompanyRole.OWNER)).rejects.toThrow(
        ForbiddenException,
      );

      expect(prisma.invitationCode.create).not.toHaveBeenCalled();
    });

    it('lets an owner create an OWNER-role invitation', async () => {
      prisma.userCompany.findUnique.mockResolvedValue({ role: CompanyRole.OWNER });
      prisma.invitationCode.create.mockResolvedValue({
        id: 'inv2',
        code: 'CODE456',
        role: CompanyRole.OWNER,
        createdAt: new Date(),
        expiresAt: null,
      });

      const result = await service.createInvitation('owner1', 'company1', CompanyRole.OWNER);

      expect(result.role).toBe(CompanyRole.OWNER);
    });
  });

  describe('useInvitation', () => {
    it("attaches the user to the invitation's company with its role", async () => {
      prisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv1',
        code: 'CODE123',
        usedAt: null,
        expiresAt: null,
        companyId: 'company1',
        role: CompanyRole.ADMIN,
      });
      prisma.invitationCode.update.mockResolvedValue({ id: 'inv1', usedAt: new Date(), usedById: 'user2' });
      prisma.userCompany.upsert.mockResolvedValue({});

      await service.useInvitation('CODE123', 'user2');

      expect(prisma.userCompany.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_companyId: { userId: 'user2', companyId: 'company1' } },
          create: { userId: 'user2', companyId: 'company1', role: CompanyRole.ADMIN },
        }),
      );
    });

    it('rejects an already-used invitation without touching membership', async () => {
      prisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv1',
        code: 'CODE123',
        usedAt: new Date(),
        expiresAt: null,
        companyId: 'company1',
        role: CompanyRole.MEMBER,
      });

      await expect(service.useInvitation('CODE123', 'user2')).rejects.toThrow();
      expect(prisma.userCompany.upsert).not.toHaveBeenCalled();
    });
  });

  // These exercise the full service (Prisma calls included), on top of
  // registration-policy.spec.ts's exhaustive coverage of the pure decision itself —
  // this is what actually wires DISABLE_AUTH and the DB lookup together.
  describe('canRegister', () => {
    const originalEnv = process.env.DISABLE_AUTH;
    afterEach(() => {
      if (originalEnv === undefined) delete process.env.DISABLE_AUTH;
      else process.env.DISABLE_AUTH = originalEnv;
    });

    it('allows the first user with no code, even with DISABLE_AUTH set', async () => {
      process.env.DISABLE_AUTH = 'true';
      prisma.user.count.mockResolvedValue(0);

      const result = await service.canRegister();

      expect(result).toEqual({ allowed: true, requiresCode: false });
    });

    it('allows open signup (no code) when DISABLE_AUTH is unset', async () => {
      delete process.env.DISABLE_AUTH;
      prisma.user.count.mockResolvedValue(5);

      const result = await service.canRegister();

      expect(result.allowed).toBe(true);
    });

    it('rejects open signup (no code) when DISABLE_AUTH is set and this is not the first user', async () => {
      process.env.DISABLE_AUTH = '1';
      prisma.user.count.mockResolvedValue(5);

      const result = await service.canRegister();

      expect(result.allowed).toBe(false);
      expect(result.message).toMatch(/disabled/i);
    });

    it('rejects an unknown code without ever calling it "disabled"', async () => {
      delete process.env.DISABLE_AUTH;
      prisma.user.count.mockResolvedValue(5);
      prisma.invitationCode.findUnique.mockResolvedValue(null);

      const result = await service.canRegister('NOPE');

      expect(result.allowed).toBe(false);
      expect(result.message).toMatch(/invalid/i);
    });

    it('rejects an expired code even though it exists and is unused', async () => {
      delete process.env.DISABLE_AUTH;
      prisma.user.count.mockResolvedValue(5);
      prisma.invitationCode.findUnique.mockResolvedValue({
        code: 'OLD-CODE',
        usedAt: null,
        expiresAt: new Date('2000-01-01'),
      });

      const result = await service.canRegister('OLD-CODE');

      expect(result.allowed).toBe(false);
      expect(result.message).toMatch(/expired/i);
    });

    it('accepts a valid code even when DISABLE_AUTH is set — a code is its own authorization', async () => {
      process.env.DISABLE_AUTH = 'true';
      prisma.user.count.mockResolvedValue(5);
      prisma.invitationCode.findUnique.mockResolvedValue({
        code: 'GOOD-CODE',
        usedAt: null,
        expiresAt: null,
      });

      const result = await service.canRegister('GOOD-CODE');

      expect(result).toEqual({ allowed: true, requiresCode: false });
    });
  });
});
