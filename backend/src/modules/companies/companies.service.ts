import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { CompanyService } from '@/modules/company/company.service';
import { EditCompanyDto } from '@/modules/company/dto/company.dto';
import { syncCompanyMemberOnMembershipChange } from '@/modules/billing/member-sync';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

/** Named so the frontend can branch on it without string-matching the (English, translated-nowhere)
 *  message — same convention as `write-gate.ts#COMPANY_BLOCKED` and `account-lifecycle.ts`'s own
 *  `ACCOUNT_IS_SOLE_OWNER_CODE`. Distinct from `assertNotLastOwner`'s plain refusal below: leaving is
 *  a self-service action a MEMBER-facing screen offers on every row including the caller's own, so it
 *  needs a message that actually tells them what to do next (transfer ownership) rather than the
 *  generic "a company must have at least one owner" a co-admin sees when trying to demote someone else.
 */
export const LAST_OWNER_CANNOT_LEAVE_CODE = 'LAST_OWNER_CANNOT_LEAVE';

@Injectable()
export class CompaniesService {
  constructor(private readonly companyService: CompanyService) {}

  async createCompany(userId: string, dto: EditCompanyDto) {
    return this.companyService.createCompany(userId, dto);
  }

  async switchActiveCompany(userId: string, sessionId: string, companyId: string) {
    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this company');
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: { activeCompanyId: companyId },
    });

    logger.info('Active company switched', { category: 'companies', details: { userId, companyId } });

    return { success: true };
  }

  async listMembers(companyId: string) {
    const members = await prisma.userCompany.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, email: true, firstname: true, lastname: true } } },
    });

    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      firstname: m.user.firstname,
      lastname: m.user.lastname,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async changeMemberRole(companyId: string, targetUserId: string, role: CompanyRole) {
    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    if (membership.role === CompanyRole.OWNER && role !== CompanyRole.OWNER) {
      await this.assertNotLastOwner(companyId);
    }

    const updated = await prisma.userCompany.update({
      where: { userId_companyId: { userId: targetUserId, companyId } },
      data: { role },
    });
    // Seat COUNT is unaffected (the person was already counted) but Polar member ACCESS may need to
    // gain or lose them — see `billing/member-sync.ts`'s own header (a no-op entirely when billing is
    // disabled, never throws).
    await syncCompanyMemberOnMembershipChange(companyId, targetUserId);

    logger.info('Member role changed', { category: 'companies', details: { companyId, targetUserId, role } });

    return updated;
  }

  async removeMember(companyId: string, actingRole: CompanyRole, targetUserId: string) {
    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    // ADMIN can remove regular members but not peers or owners.
    if (actingRole === CompanyRole.ADMIN && membership.role !== CompanyRole.MEMBER) {
      throw new ForbiddenException('Admins cannot remove owners or other admins');
    }

    if (membership.role === CompanyRole.OWNER) {
      await this.assertNotLastOwner(companyId);
    }

    await prisma.userCompany.delete({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
    // One fewer seat, freed automatically — the row (and whatever desk it held) is just gone, nothing
    // left to sync explicitly (see `billing/seat-sync.ts`'s own header).
    // The removed row is already gone by this point, so this reads as "no membership" and removes
    // any Polar member for them — see `billing/member-sync.ts`'s own header.
    await syncCompanyMemberOnMembershipChange(companyId, targetUserId);

    logger.info('Member removed', { category: 'companies', details: { companyId, targetUserId } });

    return { success: true };
  }

  /** Self-service counterpart of `removeMember` above — no `actingRole` check (a caller can always
   *  remove THEIR OWN membership, whatever their role), but the same last-owner guard applies: a
   *  company can never be left ownerless by either door. */
  async leaveCompany(companyId: string, userId: string) {
    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('You are not a member of this company');
    }

    if (membership.role === CompanyRole.OWNER) {
      await this.assertNotLastOwnerLeaving(companyId);
    }

    await prisma.userCompany.delete({
      where: { userId_companyId: { userId, companyId } },
    });
    // Same free-seat / Polar-member cleanup as `removeMember` above — the row is gone either way,
    // regardless of who initiated its removal.
    await syncCompanyMemberOnMembershipChange(companyId, userId);

    // Deliberately no explicit write to any `Session.activeCompanyId` here — the exact same choice
    // `billing/deletion.ts#deleteCompanyPermanentlyNow` already makes for the harsher "company
    // deleted" case. `lib/auth.ts`'s own `customSession` plugin recomputes `activeCompanyId` from
    // this user's CURRENT memberships on every session read, falling back to another one (or `null`)
    // the instant the stored value no longer resolves — so there is no stale value to clean up here,
    // only a stale CLIENT-side cache of an earlier session read (the frontend's own concern, not
    // this service's).
    logger.info('Member left company', { category: 'companies', details: { companyId, userId } });

    return { success: true };
  }

  private async ownerCount(companyId: string): Promise<number> {
    return prisma.userCompany.count({ where: { companyId, role: CompanyRole.OWNER } });
  }

  private async assertNotLastOwner(companyId: string) {
    const ownerCount = await this.ownerCount(companyId);
    if (ownerCount <= 1) {
      throw new BadRequestException('A company must have at least one owner');
    }
  }

  /** `leaveCompany`'s own last-owner guard — same count, a message that actually names the way out
   *  (transfer ownership) since the caller here IS the person who would be leaving, unlike
   *  `assertNotLastOwner` above where the acting user is demoting/removing someone else. */
  private async assertNotLastOwnerLeaving(companyId: string) {
    const ownerCount = await this.ownerCount(companyId);
    if (ownerCount <= 1) {
      throw new BadRequestException({
        message:
          'You are the last owner of this company. Transfer ownership to another member before leaving.',
        code: LAST_OWNER_CANNOT_LEAVE_CODE,
      });
    }
  }
}
