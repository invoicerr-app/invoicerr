import prisma from '@/prisma/prisma.service';

import { listLegalDocuments } from './legal-documents';
import { notifyUsersOfLegalReleases } from './legal-release-notify';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    legalDocumentRelease: { count: jest.fn() },
    user: { findMany: jest.fn() },
    legalDocumentReleaseNotification: { findMany: jest.fn(), createMany: jest.fn() },
  },
}));

const releaseCount = prisma.legalDocumentRelease.count as jest.Mock;
const findManyUsers = prisma.user.findMany as jest.Mock;
const findManyNotifications = prisma.legalDocumentReleaseNotification.findMany as jest.Mock;
const createManyNotifications = prisma.legalDocumentReleaseNotification.createMany as jest.Mock;

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
  findManyNotifications.mockReset().mockResolvedValue([]);
  createManyNotifications.mockReset().mockResolvedValue({ count: 0 });
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
    const sendMail = jest.fn().mockResolvedValue({ message: 'Email sent successfully' });

    const summary = await notifyUsersOfLegalReleases(fakeMailService({ sendMail }), APP_URL);

    expect(summary.releasesProcessed).toBe(1);
    expect(summary.usersNotified).toBe(2);
    expect(summary.usersFailed).toBe(0);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(createManyNotifications).toHaveBeenCalledTimes(2);
    expect(createManyNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ userId: 'user-1', slug: 'terms-of-service' })],
        skipDuplicates: true,
      }),
    );
  });

  /**
   * The actual defect this module used to have: a deploy that changed several legal documents at once
   * (here, every one of the five) sent one email PER DOCUMENT to every user instead of a single email
   * listing all of them. Regression coverage for the fix — one `sendMail` call per user, and that
   * single call's subject/body carry every changed document's title.
   */
  it('sends exactly ONE email per user when several documents change at once, listing every title', async () => {
    releaseCount.mockResolvedValue(2); // every document has moved past its bootstrap release.
    findManyUsers.mockResolvedValue([
      { id: 'user-1', email: 'user-1@example.com' },
      { id: 'user-2', email: 'user-2@example.com' },
    ]);
    const sendMail = jest.fn().mockResolvedValue({ message: 'Email sent successfully' });

    const summary = await notifyUsersOfLegalReleases(fakeMailService({ sendMail }), APP_URL);

    expect(summary.releasesProcessed).toBe(docCount);
    expect(summary.usersNotified).toBe(2);
    // One send per user, never one per (user, document) pair.
    expect(sendMail).toHaveBeenCalledTimes(2);

    const firstUserCall = sendMail.mock.calls.find(([opts]) => opts.to === 'user-1@example.com')![0];
    for (const doc of listLegalDocuments()) {
      expect(firstUserCall.html).toContain(doc.title);
    }
    // The one call's own recorded batch covers every changed document, in one atomic write.
    const firstUserWrite = createManyNotifications.mock.calls.find(([args]) =>
      args.data.every((row: { userId: string }) => row.userId === 'user-1'),
    )![0];
    expect(firstUserWrite.data).toHaveLength(docCount);
  });

  it('uses the singular subject when exactly one document changed', async () => {
    releaseCount.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      where.slug === 'terms-of-service' ? 2 : 1,
    );
    findManyUsers.mockResolvedValue([{ id: 'user-1', email: 'user-1@example.com' }]);
    const sendMail = jest.fn().mockResolvedValue({ message: 'Email sent successfully' });

    await notifyUsersOfLegalReleases(fakeMailService({ sendMail }), APP_URL);

    const [{ subject }] = sendMail.mock.calls[0];
    expect(subject).toBe('Updated legal document: Terms of Service');
  });

  it('never re-mails a user already notified for the exact same (slug, contentHash)', async () => {
    releaseCount.mockImplementation(async ({ where }: { where: { slug: string } }) =>
      where.slug === 'terms-of-service' ? 2 : 1,
    );
    findManyUsers.mockResolvedValue([{ id: 'user-1', email: 'user-1@example.com' }]);
    // Match whatever the current terms-of-service content hash actually is, rather than hard-coding one.
    const tos = listLegalDocuments().find((d) => d.slug === 'terms-of-service')!;
    findManyNotifications.mockResolvedValue([{ slug: tos.slug, contentHash: tos.contentHash }]);
    const sendMail = jest.fn();

    const summary = await notifyUsersOfLegalReleases(fakeMailService({ sendMail }), APP_URL);

    expect(sendMail).not.toHaveBeenCalled();
    expect(createManyNotifications).not.toHaveBeenCalled();
    expect(summary.usersNotified).toBe(0);
  });

  /**
   * Crash-during-send recovery: a user already caught up on SOME of the changed documents (recorded on
   * an earlier, partially-successful pass) must only be re-sent what is still pending for them — never
   * a second email repeating what they already read, and never silently dropped either.
   */
  it('retries only the still-pending documents for a user partially notified by an earlier pass', async () => {
    releaseCount.mockResolvedValue(2); // every document has changed.
    findManyUsers.mockResolvedValue([{ id: 'user-1', email: 'user-1@example.com' }]);
    const [alreadyDone, ...stillPending] = listLegalDocuments();
    findManyNotifications.mockResolvedValue([
      { slug: alreadyDone.slug, contentHash: alreadyDone.contentHash },
    ]);
    const sendMail = jest.fn().mockResolvedValue({ message: 'Email sent successfully' });

    await notifyUsersOfLegalReleases(fakeMailService({ sendMail }), APP_URL);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const [{ html }] = sendMail.mock.calls[0];
    expect(html).not.toContain(alreadyDone.title);
    for (const doc of stillPending) {
      expect(html).toContain(doc.title);
    }
    expect(createManyNotifications.mock.calls[0][0].data).toHaveLength(stillPending.length);
  });

  it('does not record a failed send, so the next pass retries the whole pending batch for that user', async () => {
    releaseCount.mockResolvedValue(2); // every document has changed.
    findManyUsers.mockResolvedValue([{ id: 'user-1', email: 'user-1@example.com' }]);
    const sendMail = jest.fn().mockRejectedValue(new Error('SMTP unreachable'));

    const summary = await notifyUsersOfLegalReleases(fakeMailService({ sendMail }), APP_URL);

    expect(summary.usersFailed).toBe(1);
    expect(summary.usersNotified).toBe(0);
    expect(createManyNotifications).not.toHaveBeenCalled();
  });

  it('processes every document past its bootstrap release, not just the first one', async () => {
    releaseCount.mockResolvedValue(2); // every one of the docCount documents has "changed".
    findManyUsers.mockResolvedValue([{ id: 'user-1', email: 'user-1@example.com' }]);

    const summary = await notifyUsersOfLegalReleases(fakeMailService(), APP_URL);

    expect(summary.releasesProcessed).toBe(docCount);
  });
});
