import prisma from '@/prisma/prisma.service';

import { listLegalDocuments } from './legal-documents';
import { notifyUsersOfLegalReleases } from './legal-release-notify';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    legalDocumentRelease: { count: jest.fn() },
    user: { findMany: jest.fn() },
    legalDocumentReleaseNotification: { findUnique: jest.fn(), create: jest.fn() },
  },
}));

const releaseCount = prisma.legalDocumentRelease.count as jest.Mock;
const findManyUsers = prisma.user.findMany as jest.Mock;
const findNotification = prisma.legalDocumentReleaseNotification.findUnique as jest.Mock;
const createNotification = prisma.legalDocumentReleaseNotification.create as jest.Mock;

const APP_URL = 'https://invoicerr.test';
const docCount = listLegalDocuments().length;

function fakeMailService(overrides: { sendMail?: jest.Mock } = {}) {
  return {
    sendMail: overrides.sendMail ?? jest.fn().mockResolvedValue({ message: 'Email sent successfully' }),
  } as unknown as import('@/mail/mail.service').MailService;
}

beforeEach(() => {
  releaseCount.mockReset();
  findManyUsers.mockReset();
  findNotification.mockReset();
  createNotification.mockReset().mockResolvedValue({});
});

describe('notifyUsersOfLegalReleases', () => {
  it('processes NOTHING when every slug only ever had a bootstrap release', async () => {
    releaseCount.mockResolvedValue(1);
    findManyUsers.mockResolvedValue([{ id: 'user-1', email: 'user-1@example.com' }]);

    const summary = await notifyUsersOfLegalReleases(fakeMailService(), APP_URL);

    expect(summary).toEqual({ releasesProcessed: 0, usersNotified: 0, usersFailed: 0 });
    expect(findManyUsers).not.toHaveBeenCalled();
  });

  it('mails every user exactly once for a slug that has moved past its bootstrap release', async () => {
    releaseCount.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      where.slug === 'terms-of-service' ? 2 : 1,
    );
    findManyUsers.mockResolvedValue([
      { id: 'user-1', email: 'user-1@example.com' },
      { id: 'user-2', email: 'user-2@example.com' },
    ]);
    findNotification.mockResolvedValue(null);
    const sendMail = jest.fn().mockResolvedValue({ message: 'Email sent successfully' });

    const summary = await notifyUsersOfLegalReleases(fakeMailService({ sendMail }), APP_URL);

    expect(summary.releasesProcessed).toBe(1);
    expect(summary.usersNotified).toBe(2);
    expect(summary.usersFailed).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', slug: 'terms-of-service' }),
      }),
    );
  });

  it('never re-mails a user already notified for the exact same (slug, contentHash)', async () => {
    releaseCount.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      where.slug === 'terms-of-service' ? 2 : 1,
    );
    findManyUsers.mockResolvedValue([{ id: 'user-1', email: 'user-1@example.com' }]);
    findNotification.mockResolvedValue({ id: 'already-sent' });
    const sendMail = jest.fn();

    const summary = await notifyUsersOfLegalReleases(fakeMailService({ sendMail }), APP_URL);

    expect(sendMail).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(summary.usersNotified).toBe(0);
  });

  it('does not record a failed send, so it is retried on the next pass', async () => {
    releaseCount.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      where.slug === 'terms-of-service' ? 2 : 1,
    );
    findManyUsers.mockResolvedValue([{ id: 'user-1', email: 'user-1@example.com' }]);
    findNotification.mockResolvedValue(null);
    const sendMail = jest.fn().mockRejectedValue(new Error('SMTP unreachable'));

    const summary = await notifyUsersOfLegalReleases(fakeMailService({ sendMail }), APP_URL);

    expect(summary.usersFailed).toBe(1);
    expect(summary.usersNotified).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('processes every document past its bootstrap release, not just the first one', async () => {
    releaseCount.mockResolvedValue(2); // every one of the docCount documents has "changed".
    findManyUsers.mockResolvedValue([{ id: 'user-1', email: 'user-1@example.com' }]);
    findNotification.mockResolvedValue(null);

    const summary = await notifyUsersOfLegalReleases(fakeMailService(), APP_URL);

    expect(summary.releasesProcessed).toBe(docCount);
  });
});
