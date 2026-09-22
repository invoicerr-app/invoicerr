import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { CompanyService } from '@/modules/company/company.service';
import { EditCompanyDto } from '@/modules/company/dto/company.dto';
import { syncCompanyMemberOnMembershipChange } from '@/modules/billing/member-sync';
import {
  BillingExportService,
  ExportZipTimedOutError,
  ExportZipTooLargeError,
} from '@/modules/billing/export-zip.service';
import { MailService } from '@/mail/mail.service';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

/** How long a company must wait between two self-service exports (`exportCompanyData` below) —
 *  building one means rendering EVERY document the company holds through Chromium
 *  (`export-zip.service.ts`'s own header), up to its own 5-minute cap: long enough that a double
 *  click or an impatient retry loop cannot force back-to-back full rebuilds, short enough that an
 *  OWNER who genuinely needs a second copy is never blocked for long. */
export const SELF_SERVICE_EXPORT_COOLDOWN_MINUTES = 15;

/** Above this many compressed bytes, the export is emailed instead of streamed back in the HTTP
 *  response (`exportCompanyData` below) — a large zip built through a slow upstream proxy risks the
 *  connection dying mid-download with nothing to resume from, while a small one is nicer served
 *  straight to the browser: no inbox to go check, no attachment size limit to worry about. */
export const SELF_SERVICE_EXPORT_STREAM_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5 MiB

/** Named so the frontend can branch on it without string-matching the message — same convention as
 *  `LAST_OWNER_CANNOT_LEAVE_CODE` above. */
export const SELF_SERVICE_EXPORT_RATE_LIMITED_CODE = 'SELF_SERVICE_EXPORT_RATE_LIMITED';

export type ExportCompanyDataResult = { mode: 'stream'; zip: Buffer } | { mode: 'emailed'; to: string };

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
  constructor(
    private readonly companyService: CompanyService,
    private readonly exportService: BillingExportService,
    private readonly mailService: MailService,
  ) {}

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

  /**
   * The self-service counterpart of the export the billing lifecycle sweep already mails an OWNER
   * automatically once a subscription is blocked (`billing-lifecycle-sweep-runner.ts#sendZipToOwner`)
   * and `danger.service.ts#deleteCompany` sends before an irreversible delete — a company must not
   * have to write to support just to get a copy of everything it holds. Reuses
   * `BillingExportService.buildCompanyZip` verbatim (same bounds, same per-document PDF-or-JSON
   * fallback) rather than a second export path that could drift from the one already proven by the
   * billing sweep's own tests.
   *
   * Rate-limited with a compare-and-set `updateMany` claimed BEFORE the expensive build even starts —
   * the same CAS discipline `billing-lifecycle-sweep-runner.ts#applyOne` already uses against a
   * concurrent WEBHOOK, reused here against a concurrent REQUEST (a double click, e.g.): two calls
   * racing each other can never both pass, because the second one's `WHERE` no longer matches once the
   * first has already written `now`. The slot is spent even if the build itself later fails — building
   * is the costly step this cooldown exists to bound, not the delivery that follows it, so a company
   * whose build failed still has to wait out the same window before hammering it again.
   */
  async exportCompanyData(companyId: string, requestedByEmail: string): Promise<ExportCompanyDataResult> {
    await this.claimExportSlot(companyId);

    let zip: Buffer;
    try {
      zip = await this.exportService.buildCompanyZip(companyId);
    } catch (error) {
      if (error instanceof ExportZipTooLargeError || error instanceof ExportZipTimedOutError) {
        logger.error('Self-service export refused — exceeded its size/time bound', {
          category: 'companies',
          details: { companyId, error: error.message },
        });
        throw new BadRequestException(
          'Your company has too much data to export this way right now — contact support for a ' +
            'manual export.',
        );
      }
      throw error;
    }

    if (zip.length <= SELF_SERVICE_EXPORT_STREAM_THRESHOLD_BYTES) {
      return { mode: 'stream', zip };
    }

    try {
      // To the REQUESTING user's own inbox, not "the oldest OWNER" the automated sweep addresses
      // (`billing-lifecycle-sweep-runner.ts#findOldestOwner`) — this call has a real,
      // already-authenticated caller in hand, the same choice `danger.service.ts#deleteCompany`
      // already makes for its own export mail.
      await this.mailService.sendForCompany(companyId, {
        to: requestedByEmail,
        subject: 'Your company data export',
        text:
          'Attached is a full export of everything your company holds on Invoicerr, as you just ' +
          'requested.',
        attachments: [{ filename: 'invoicerr-export.zip', content: zip, contentType: 'application/zip' }],
      });
    } catch (error) {
      if (error instanceof HttpException) throw error; // e.g. the "no mail server configured" refusal
      logger.error('Self-service export was built but could not be emailed', {
        category: 'companies',
        details: { companyId, error: error instanceof Error ? error.message : String(error) },
      });
      throw new BadRequestException('Your export was built but could not be emailed — try again shortly.');
    }

    return { mode: 'emailed', to: requestedByEmail };
  }

  /** Atomically claims this company's export slot, or refuses with 429 when the cooldown has not
   *  elapsed yet — see `exportCompanyData`'s own header for why this runs BEFORE the build. */
  private async claimExportSlot(companyId: string): Promise<void> {
    const now = new Date();
    const cooldownStartedAt = new Date(now.getTime() - SELF_SERVICE_EXPORT_COOLDOWN_MINUTES * 60_000);

    const claimed = await prisma.company.updateMany({
      where: {
        id: companyId,
        OR: [{ lastSelfServiceExportAt: null }, { lastSelfServiceExportAt: { lt: cooldownStartedAt } }],
      },
      data: { lastSelfServiceExportAt: now },
    });
    if (claimed.count > 0) return;

    const current = await prisma.company.findUnique({
      where: { id: companyId },
      select: { lastSelfServiceExportAt: true },
    });
    const retryAt = current?.lastSelfServiceExportAt
      ? new Date(current.lastSelfServiceExportAt.getTime() + SELF_SERVICE_EXPORT_COOLDOWN_MINUTES * 60_000)
      : now;
    const retryAfterSeconds = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000));

    throw new HttpException(
      {
        message:
          `You can only export your company's full data once every ` +
          `${SELF_SERVICE_EXPORT_COOLDOWN_MINUTES} minutes — try again shortly.`,
        code: SELF_SERVICE_EXPORT_RATE_LIMITED_CODE,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
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
