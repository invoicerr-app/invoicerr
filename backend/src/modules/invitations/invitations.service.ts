import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { CompanyRole, InvitationCode } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { decideRegistration, registrationDenialMessage } from '@/lib/registration-policy';
import { NO_FREE_SEAT_CODE, NoFreeSeatError, withSeatReservation } from '@/modules/billing/seat-sync';
import { syncCompanyMemberOnMembershipChange } from '@/modules/billing/member-sync';
import { logger } from '@/logger/logger.service';

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  private generateCode(): string {
    return randomBytes(16).toString('hex').toUpperCase();
  }

  // Same decision the better-auth signup hook enforces (lib/registration-policy.ts) — this
  // is the front end's pre-flight check, called before the actual `authClient.signUp.email`
  // call so a bad/expired/used code (or a closed instance) surfaces as a form error instead
  // of a generic "something went wrong" from better-auth. `requiresCode` tells the caller
  // whether the only remaining path forward is a valid invitation code.
  async canRegister(
    invitationCode?: string,
  ): Promise<{ allowed: boolean; requiresCode: boolean; message?: string }> {
    const isFirstUser = (await this.prisma.user.count()) === 0;

    let invitation:
      | { found: true; usedAt: Date | null; expiresAt: Date | null }
      | { found: false }
      | undefined;
    if (invitationCode) {
      const record = await this.prisma.invitationCode.findUnique({ where: { code: invitationCode } });
      invitation = record
        ? { found: true, usedAt: record.usedAt, expiresAt: record.expiresAt }
        : { found: false };
    }

    const decision = decideRegistration({ invitationCode, invitation, isFirstUser });

    if (!decision.allowed) {
      return { allowed: false, requiresCode: true, message: registrationDenialMessage(decision.reason) };
    }

    return { allowed: true, requiresCode: false };
  }

  async isFirstUser(): Promise<boolean> {
    const userCount = await this.prisma.user.count();
    return userCount === 0;
  }

  async createInvitation(createdById: string, companyId: string, role: CompanyRole, expiresInDays?: number) {
    // Only an OWNER can mint an invitation that would create a peer OWNER.
    if (role === CompanyRole.OWNER) {
      const creatorMembership = await this.prisma.userCompany.findUnique({
        where: { userId_companyId: { userId: createdById, companyId } },
      });
      if (creatorMembership?.role !== CompanyRole.OWNER) {
        throw new ForbiddenException('Only an owner can invite another owner');
      }
    }

    const code = this.generateCode();

    const invitation = await this.prisma.invitationCode.create({
      data: {
        code,
        createdById,
        companyId,
        role,
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
      },
    });

    // Never log `invitation.code` itself: a still-valid code IS the bearer credential that grants
    // access to a company, so it must not end up in application logs (and whatever log-shipping
    // chain collects them) any more than a password would. `id` identifies the row for support/
    // debugging without leaking the capability.
    logger.info('Invitation created', {
      category: 'invitation',
      details: { id: invitation.id, createdById, companyId, role },
    });

    return {
      id: invitation.id,
      code: invitation.code,
      role: invitation.role,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    };
  }

  async useInvitation(code: string, userId: string) {
    const invitation = await this.prisma.invitationCode.findUnique({
      where: { code },
    });

    if (!invitation) {
      // No row to point at by `id` here — the code itself doesn't exist. Logging a short prefix
      // (not the full 32-hex-char secret `generateCode()` mints) keeps enough to correlate a support
      // report without leaving 96 bits of the still-guessable remainder in the logs.
      logger.warn('Invitation code not found', {
        category: 'invitation',
        details: { codePrefix: code.slice(0, 8) },
      });
      throw new NotFoundException('Invitation code not found');
    }

    if (invitation.usedAt) {
      logger.warn('Invitation code already used', { category: 'invitation', details: { id: invitation.id } });
      throw new BadRequestException('This invitation code has already been used');
    }

    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      logger.warn('Invitation code expired', { category: 'invitation', details: { id: invitation.id } });
      throw new BadRequestException('This invitation code has expired');
    }

    // Marking the code used and attaching the caller to the company/role it was issued for happen in
    // the SAME transaction as the seat reservation — a `NoFreeSeatError` (thrown before either write
    // runs, see `withSeatReservation`'s own header) rolls the invitation's own `usedAt` back too, so a
    // refused code stays valid to retry once a seat frees up rather than being burned for nothing.
    let updatedInvitation: InvitationCode;
    try {
      updatedInvitation = await withSeatReservation(invitation.companyId, userId, async (tx) => {
        const updated = await tx.invitationCode.update({
          where: { id: invitation.id },
          data: { usedAt: new Date(), usedById: userId },
        });
        // Upsert (not a plain create): re-using an invitation link for a user who somehow already
        // belongs to the company is a no-op, never a unique-constraint failure.
        await tx.userCompany.upsert({
          where: { userId_companyId: { userId, companyId: invitation.companyId } },
          create: { userId, companyId: invitation.companyId, role: invitation.role },
          update: {},
        });
        return updated;
      });
    } catch (error) {
      if (error instanceof NoFreeSeatError) {
        logger.warn('Invitation refused — no free seat', {
          category: 'invitation',
          details: { id: invitation.id, userId, companyId: invitation.companyId },
        });
        throw new ForbiddenException({ message: error.message, code: NO_FREE_SEAT_CODE });
      }
      throw error;
    }

    logger.info('Invitation code used', { category: 'invitation', details: { id: invitation.id, userId } });

    // An invitation can carry OWNER/ADMIN — see `billing/member-sync.ts`'s own header.
    await syncCompanyMemberOnMembershipChange(invitation.companyId, userId);

    return updatedInvitation;
  }

  async listInvitations(companyId: string) {
    return this.prisma.invitationCode.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        usedAt: true,
        usedBy: {
          select: {
            id: true,
            email: true,
            firstname: true,
            lastname: true,
          },
        },
      },
    });
  }

  async deleteInvitation(id: string, companyId: string) {
    const invitation = await this.prisma.invitationCode.findFirst({
      where: {
        id,
        companyId,
        usedAt: null,
      },
    });

    if (!invitation) {
      logger.warn('Invitation not found or already used', {
        category: 'invitation',
        details: { id, companyId },
      });
      throw new NotFoundException('Invitation not found or already used');
    }

    await this.prisma.invitationCode.delete({
      where: { id },
    });

    logger.info('Invitation deleted', { category: 'invitation', details: { id, companyId } });

    return { success: true };
  }
}
