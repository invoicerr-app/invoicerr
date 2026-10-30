import { sessionCache } from '@/lib/session-cache';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { CompanyRole, InvitationCode } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { decideRegistration, registrationDenialMessage } from '@/lib/registration-policy';
import { NO_FREE_SEAT_CODE, NoFreeSeatError, withSeatReservation } from '@/modules/billing/seat-sync';
import { syncCompanyMemberOnMembershipChange } from '@/modules/billing/member-sync';
import { logger } from '@/logger/logger.service';
import { hashInvitationCode, invitationCodePrefix, invitationCodesMatch } from '@/lib/invitation-code';

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  private generateCode(): string {
    return randomBytes(16).toString('hex').toUpperCase();
  }

  /**
   * Resolves a presented code to its row. The digest is the only thing a current row stores; a row
   * written before the switch still carries its plaintext `code` until the boot backfill reaches it,
   * so it is matched here once, digested in place, and then behaves like any other row. Without this
   * lookup an upgrade would refuse every invitation issued before it until the next boot.
   */
  private async findByPresentedCode(code: string): Promise<InvitationCode | null> {
    const codeHash = hashInvitationCode(code);
    const byHash = await this.prisma.invitationCode.findUnique({ where: { codeHash } });
    if (byHash) return byHash;

    const legacy = await this.prisma.invitationCode.findUnique({ where: { code } });
    if (!legacy) return null;

    await this.prisma.invitationCode.updateMany({
      where: { id: legacy.id, code: { not: null } },
      data: { code: null, codeHash, codePrefix: invitationCodePrefix(code) },
    });
    return { ...legacy, code: null, codeHash };
  }

  // Same decision the better-auth signup hook enforces (lib/registration-policy.ts) — this
  // is the front end's pre-flight check, called before the actual `authClient.signUp.email`
  // call so a bad/expired/used code (or a closed instance) surfaces as a form error instead
  // of a generic "something went wrong" from better-auth. `requiresCode` tells the caller
  // whether a valid invitation code is still a way forward; false on a closed demo instance.
  async canRegister(
    invitationCode?: string,
  ): Promise<{ allowed: boolean; requiresCode: boolean; message?: string }> {
    const isFirstUser = (await this.prisma.user.count()) === 0;

    let invitation:
      | { found: true; usedAt: Date | null; expiresAt: Date | null }
      | { found: false }
      | undefined;
    if (invitationCode) {
      const record = await this.findByPresentedCode(invitationCode);
      invitation = record
        ? { found: true, usedAt: record.usedAt, expiresAt: record.expiresAt }
        : { found: false };
    }

    const decision = decideRegistration({ invitationCode, invitation, isFirstUser });

    if (!decision.allowed) {
      return {
        allowed: false,
        requiresCode: decision.reason !== 'demo_mode',
        message: registrationDenialMessage(decision.reason),
      };
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
        // Only the digest and the preview are persisted — the plaintext code leaves this process in
        // the HTTP response below and is never written to the database, a log or Redis again.
        codeHash: hashInvitationCode(code),
        codePrefix: invitationCodePrefix(code),
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
      // The one and only time this value is ever returned: the row stores no plaintext to re-read.
      code,
      role: invitation.role,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    };
  }

  async useInvitation(code: string, userId: string) {
    // Looked up by digest: the row no longer holds anything a dump could replay. The explicit
    // constant-time re-check below covers a row whose digest was written by an older, incompatible
    // key (nothing matches, so the code is simply refused rather than trusted on the index alone).
    const invitation = await this.findByPresentedCode(code);

    if (!invitation || !invitation.codeHash || !invitationCodesMatch(code, invitation.codeHash)) {
      // No row to point at by `id` here — the code itself doesn't exist. Logging a short prefix
      // (not the full 32-hex-char secret `generateCode()` mints) keeps enough to correlate a support
      // report without leaving 96 bits of the still-guessable remainder in the logs.
      logger.warn('Invitation code not found', {
        category: 'invitation',
        details: { codePrefix: invitationCodePrefix(code) },
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
    //
    // `updateMany` guarded on `usedAt: null`, never a plain `update` — the `usedAt` check just above
    // this block is OUTSIDE the transaction, so two concurrent requests for the SAME still-unused code
    // (two tabs opening one invitation link at once) would otherwise both pass it and both write,
    // minting two `UserCompany` rows for one nominative invitation. `withSeatReservation`'s own row
    // lock only serializes concurrent reservations for the SAME company when billing is enabled (see
    // that function's own header); self-hosted mode — the default — runs with no lock at all, so this
    // guarded `WHERE usedAt IS NULL` is what actually makes consumption atomic in every mode. Mirrors
    // the identical fix in `lib/auth.ts#markInvitationAsUsed`.
    let updatedInvitation: InvitationCode;
    try {
      updatedInvitation = await withSeatReservation(invitation.companyId, userId, async (tx) => {
        const { count } = await tx.invitationCode.updateMany({
          where: { id: invitation.id, usedAt: null },
          data: { usedAt: new Date(), usedById: userId },
        });
        if (count === 0) {
          throw new BadRequestException('This invitation code has already been used');
        }
        // Upsert (not a plain create): re-using an invitation link for a user who somehow already
        // belongs to the company is a no-op, never a unique-constraint failure.
        await tx.userCompany.upsert({
          where: { userId_companyId: { userId, companyId: invitation.companyId } },
          create: { userId, companyId: invitation.companyId, role: invitation.role },
          update: {},
        });
        return tx.invitationCode.findUniqueOrThrow({ where: { id: invitation.id } });
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

    await sessionCache.invalidateUsers([userId]);
    logger.info('Invitation code used', { category: 'invitation', details: { id: invitation.id, userId } });

    // An invitation can carry OWNER/ADMIN — see `billing/member-sync.ts`'s own header.
    await syncCompanyMemberOnMembershipChange(invitation.companyId, userId);

    return updatedInvitation;
  }

  async listInvitations(companyId: string) {
    const invitations = await this.prisma.invitationCode.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        // The full code is not in the row any more; the screen gets the eight-character preview it
        // always displayed, under the same `code` field the front end and its specs already read.
        codePrefix: true,
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

    return invitations.map((invitation) => ({
      id: invitation.id,
      code: invitation.codePrefix ?? '',
      role: invitation.role,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      usedAt: invitation.usedAt,
      usedBy: invitation.usedBy,
    }));
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
