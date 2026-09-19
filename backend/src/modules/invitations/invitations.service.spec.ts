import { vi, type Mock } from 'vitest';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from '@/modules/invitations/invitations.service';
import { PrismaService } from '@/prisma/prisma.service';
import { NoFreeSeatError, withSeatReservation } from '@/modules/billing/seat-sync';
import { logger } from '@/logger/logger.service';

vi.mock('@/logger/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('@/modules/billing/member-sync');
// billing/seat-sync.ts's own header: called directly (never via DI) from the three places a
// membership row is CREATED — `useInvitation` (an EXISTING user accepting an invitation) is one of
// them. Mocked here so this file's own assertions never depend on the real transaction/lock
// behavior (already covered in full by seat-sync.spec.ts); the default implementation below just
// runs the caller's own callback against this file's already-mocked `prisma`, so `tx.*` calls inside
// `useInvitation` land on the SAME mocks every other assertion here already reads.
vi.mock('@/modules/billing/seat-sync');

const seatReservation = withSeatReservation as Mock;

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: {
    invitationCode: {
      create: Mock;
      findUnique: Mock;
      updateMany: Mock;
      findUniqueOrThrow: Mock;
    };
    userCompany: {
      findUnique: Mock;
      upsert: Mock;
    };
    user: {
      count: Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      invitationCode: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn(),
      },
      userCompany: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      user: {
        count: vi.fn(),
      },
    };
    service = new InvitationsService(prisma as unknown as PrismaService);
    // Default: run the caller's own transaction callback against this file's own `prisma` fake, so
    // `tx.invitationCode.update`/`tx.userCompany.upsert` inside `useInvitation` land on the same mocks
    // every assertion below already reads. A test that needs to exercise the `NoFreeSeatError` path
    // overrides this with `seatReservation.mockRejectedValue(...)` instead.
    seatReservation.mockImplementation((_companyId: string, _userId: string, fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
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

    it('logs the invitation id, never the code itself — a still-valid code is a bearer secret', async () => {
      prisma.invitationCode.create.mockResolvedValue({
        id: 'inv1',
        code: 'CODE123',
        role: CompanyRole.MEMBER,
        createdAt: new Date(),
        expiresAt: null,
      });

      await service.createInvitation('user1', 'company1', CompanyRole.MEMBER);

      expect(logger.info).toHaveBeenCalledWith('Invitation created', {
        category: 'invitation',
        details: { id: 'inv1', createdById: 'user1', companyId: 'company1', role: CompanyRole.MEMBER },
      });
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
      prisma.invitationCode.updateMany.mockResolvedValue({ count: 1 });
      prisma.invitationCode.findUniqueOrThrow.mockResolvedValue({
        id: 'inv1',
        usedAt: new Date(),
        usedById: 'user2',
      });
      prisma.userCompany.upsert.mockResolvedValue({});

      await service.useInvitation('CODE123', 'user2');

      expect(prisma.userCompany.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_companyId: { userId: 'user2', companyId: 'company1' } },
          create: { userId: 'user2', companyId: 'company1', role: CompanyRole.ADMIN },
        }),
      );
      // The membership write, and marking the code used, both run through the seat reservation for
      // the company the invitation was accepted into — a no-op in an environment without the billing
      // flag (`withSeatReservation`'s own header), but the call itself must always happen.
      expect(seatReservation).toHaveBeenCalledWith('company1', 'user2', expect.any(Function));
      // `updateMany`, guarded on `usedAt: null` — see this call site's own header on why a plain
      // `update` would race two concurrent acceptances of the same code.
      expect(prisma.invitationCode.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv1', usedAt: null },
        data: { usedAt: expect.any(Date), usedById: 'user2' },
      });
      // Never the code itself — see `createInvitation`'s own test on why.
      expect(logger.info).toHaveBeenCalledWith('Invitation code used', {
        category: 'invitation',
        details: { id: 'inv1', userId: 'user2' },
      });
    });

    it(
      'a SECOND, concurrent acceptance of the same code is refused, not double-applied — reproduces the ' +
        'race: both requests pass the outer `usedAt` check (read before either writes), but only the ' +
        'first `updateMany` actually matches a row',
      async () => {
        prisma.invitationCode.findUnique.mockResolvedValue({
          id: 'inv1',
          code: 'CODE123',
          usedAt: null,
          expiresAt: null,
          companyId: 'company1',
          role: CompanyRole.MEMBER,
        });
        // The guarded updateMany matches zero rows — exactly what a real Postgres `WHERE usedAt IS
        // NULL` reports once a concurrent request already flipped it.
        prisma.invitationCode.updateMany.mockResolvedValue({ count: 0 });

        await expect(service.useInvitation('CODE123', 'user3')).rejects.toThrow(
          'This invitation code has already been used',
        );
        expect(prisma.userCompany.upsert).not.toHaveBeenCalled();
      },
    );

    it('refuses, named NO_FREE_SEAT, when the company has no free seat — the invitation stays unused', async () => {
      prisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv1',
        code: 'CODE123',
        usedAt: null,
        expiresAt: null,
        companyId: 'full-company',
        role: CompanyRole.MEMBER,
      });
      seatReservation.mockRejectedValue(new NoFreeSeatError('full-company'));

      const action = service.useInvitation('CODE123', 'user2');

      await expect(action).rejects.toBeInstanceOf(ForbiddenException);
      const err = await action.catch((e) => e);
      expect(err.getResponse()).toMatchObject({ code: 'NO_FREE_SEAT' });
      expect(logger.warn).toHaveBeenCalledWith('Invitation refused — no free seat', {
        category: 'invitation',
        details: { id: 'inv1', userId: 'user2', companyId: 'full-company' },
      });
    });

    it('rejects an unknown code, logging only a short prefix — the full code never existed to point an id at', async () => {
      prisma.invitationCode.findUnique.mockResolvedValue(null);

      await expect(service.useInvitation('DEADBEEF00000000DEADBEEF00000000', 'user2')).rejects.toThrow(
        NotFoundException,
      );
      expect(logger.warn).toHaveBeenCalledWith('Invitation code not found', {
        category: 'invitation',
        details: { codePrefix: 'DEADBEEF' },
      });
    });

    it('accepting an invitation into a company whose subscription is PAST_DUE/BLOCKED still succeeds — this service never queries CompanySubscription at all', async () => {
      // The decision (product brief): an invitee must not be locked out of joining just because the
      // COMPANY they are joining owes money — they land in the same "please regularize" screen every
      // other member of a blocked company already sees (the billing banner reads status off
      // `GET /billing/status`, gated by nothing role-specific). Proven here structurally: this
      // service has no billing-status read/gate anywhere in it (`CompanyWriteGuard` itself never
      // applies either — it only fires for a request carrying an ACTIVE company id, and invitation
      // acceptance runs from better-auth's own hooks, outside Nest's guard pipeline entirely), so a
      // blocked company's own subscription status is simply never consulted on this path.
      prisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv2',
        code: 'CODE456',
        usedAt: null,
        expiresAt: null,
        companyId: 'blocked-company',
        role: CompanyRole.MEMBER,
      });
      prisma.invitationCode.updateMany.mockResolvedValue({ count: 1 });
      prisma.invitationCode.findUniqueOrThrow.mockResolvedValue({
        id: 'inv2',
        usedAt: new Date(),
        usedById: 'user3',
      });
      prisma.userCompany.upsert.mockResolvedValue({});

      await expect(service.useInvitation('CODE456', 'user3')).resolves.toBeDefined();

      expect(prisma.userCompany.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { userId: 'user3', companyId: 'blocked-company', role: CompanyRole.MEMBER },
        }),
      );
      expect(seatReservation).toHaveBeenCalledWith('blocked-company', 'user3', expect.any(Function));
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
      expect(logger.warn).toHaveBeenCalledWith('Invitation code already used', {
        category: 'invitation',
        details: { id: 'inv1' },
      });
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
