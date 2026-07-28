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
});
