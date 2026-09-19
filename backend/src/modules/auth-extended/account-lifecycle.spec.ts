import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { syncCompanyMemberOnMembershipChange } from '@/modules/billing/member-sync';

import {
  ACCOUNT_IS_SOLE_OWNER_CODE,
  AccountMailer,
  SoleOwnerError,
  assertNotSoleOwner,
  buildChangeEmailMail,
  cleanupAfterUserDelete,
  sendChangeEmailMail,
} from './account-lifecycle';

// Same shape `danger.service.spec.ts` and `invitations.service.spec.ts` already use for a module that
// imports the shared `prisma` singleton directly (never via Nest DI) — `findMany`/`count` are the only
// two calls this file's functions ever make.
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    userCompany: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));
jest.mock('@/modules/billing/member-sync');
jest.mock('@/logger/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import prisma from '@/prisma/prisma.service';

const mockPrisma = prisma as unknown as {
  userCompany: { findMany: jest.Mock; count: jest.Mock };
};
const syncMember = syncCompanyMemberOnMembershipChange as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildChangeEmailMail / sendChangeEmailMail', () => {
  it('addresses the mail to the NEW email and includes the confirmation url', () => {
    const mail = buildChangeEmailMail({
      newEmail: 'new@acme.org',
      url: 'https://app.test/api/auth/verify-email?token=abc',
      appUrl: 'https://app.test',
    });

    expect(mail.to).toBe('new@acme.org');
    expect(mail.subject).toBeTruthy();
    expect(mail.text).toContain('https://app.test/api/auth/verify-email?token=abc');
    expect(mail.html).toContain('https://app.test/api/auth/verify-email?token=abc');
  });

  it('sends via the given mailer — the INSTANCE path, never a per-company cascade', async () => {
    const mailer: AccountMailer = { sendMail: jest.fn().mockResolvedValue({ message: 'ok' }) };

    await sendChangeEmailMail(mailer, {
      newEmail: 'new@acme.org',
      url: 'https://app.test/verify?token=xyz',
      appUrl: 'https://app.test',
    });

    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    const sent = (mailer.sendMail as jest.Mock).mock.calls[0][0];
    expect(sent.to).toBe('new@acme.org');
    expect(sent.text + sent.html).toContain('https://app.test/verify?token=xyz');
  });

  it('defaults to English when no language is given', () => {
    const mail = buildChangeEmailMail({
      newEmail: 'new@acme.org',
      url: 'https://app.test/verify',
      appUrl: 'https://app.test',
    });
    expect(mail.subject).toBe('Confirm your email address');
  });

  it("uses the user's own locale when given", () => {
    const mail = buildChangeEmailMail({
      newEmail: 'new@acme.org',
      url: 'https://app.test/verify',
      appUrl: 'https://app.test',
      language: 'fr',
    });
    expect(mail.subject).toBe('Confirmez votre adresse e-mail');
    expect(mail.html).toContain('Confirmez votre adresse e-mail');
  });

  it('falls back to English for a locale this catalog does not carry', () => {
    const mail = buildChangeEmailMail({
      newEmail: 'new@acme.org',
      url: 'https://app.test/verify',
      appUrl: 'https://app.test',
      language: 'es',
    });
    expect(mail.subject).toBe('Confirm your email address');
  });
});

describe('assertNotSoleOwner', () => {
  it('refuses, named ACCOUNT_IS_SOLE_OWNER, when the user is the ONLY owner of a company', async () => {
    mockPrisma.userCompany.findMany.mockResolvedValue([
      { companyId: 'co-1', role: CompanyRole.OWNER, company: { name: 'Acme' } },
    ]);
    mockPrisma.userCompany.count.mockResolvedValue(0); // no OTHER owner of co-1

    const action = assertNotSoleOwner('user-1');

    await expect(action).rejects.toBeInstanceOf(SoleOwnerError);
    await expect(action).rejects.toMatchObject({ code: ACCOUNT_IS_SOLE_OWNER_CODE });
    await expect(action).rejects.toThrow(/Acme/);
  });

  it('accepts when another OWNER exists for every company the user owns', async () => {
    mockPrisma.userCompany.findMany.mockResolvedValue([
      { companyId: 'co-1', role: CompanyRole.OWNER, company: { name: 'Acme' } },
    ]);
    mockPrisma.userCompany.count.mockResolvedValue(1); // a co-owner exists

    await expect(assertNotSoleOwner('user-1')).resolves.toEqual([
      { companyId: 'co-1', companyName: 'Acme', role: CompanyRole.OWNER },
    ]);
  });

  it('accepts a user who owns nothing — MEMBER/ADMIN memberships never trigger the owner check', async () => {
    mockPrisma.userCompany.findMany.mockResolvedValue([
      { companyId: 'co-2', role: CompanyRole.MEMBER, company: { name: 'Beta' } },
    ]);

    await expect(assertNotSoleOwner('user-1')).resolves.toEqual([
      { companyId: 'co-2', companyName: 'Beta', role: CompanyRole.MEMBER },
    ]);
    expect(mockPrisma.userCompany.count).not.toHaveBeenCalled();
  });

  it('lists every company the user is the sole owner of, not just the first', async () => {
    mockPrisma.userCompany.findMany.mockResolvedValue([
      { companyId: 'co-1', role: CompanyRole.OWNER, company: { name: 'Acme' } },
      { companyId: 'co-2', role: CompanyRole.OWNER, company: { name: 'Beta' } },
    ]);
    mockPrisma.userCompany.count.mockResolvedValue(0);

    await expect(assertNotSoleOwner('user-1')).rejects.toThrow(/Acme.*Beta|Beta.*Acme/);
  });
});

describe('cleanupAfterUserDelete', () => {
  const deletedUser = { id: 'user-1', email: 'deleted@acme.test', name: 'Deleted User' };

  it('resyncs Polar members for every company the deleted user belonged to', async () => {
    await cleanupAfterUserDelete(
      [
        { companyId: 'co-1', companyName: 'Acme', role: CompanyRole.OWNER },
        { companyId: 'co-2', companyName: 'Beta', role: CompanyRole.MEMBER },
      ],
      deletedUser,
    );

    expect(syncMember).toHaveBeenCalledWith('co-1', 'user-1', undefined, deletedUser);
    expect(syncMember).toHaveBeenCalledWith('co-2', 'user-1', undefined, deletedUser);
  });

  it('is a no-op for a user who belonged to no company', async () => {
    await cleanupAfterUserDelete([], deletedUser);
    expect(syncMember).not.toHaveBeenCalled();
  });
});
