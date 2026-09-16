import { BILLING_FLAG_NAME } from '../modules/billing/billing-flag';
import { LegalReleaseBootService } from './legal-release-boot.service';
import { detectAndRecordNewLegalReleases } from './legal-release-detection';
import { notifyUsersOfLegalReleases } from './legal-release-notify';

jest.mock('./legal-release-detection');
jest.mock('./legal-release-notify');

const detect = detectAndRecordNewLegalReleases as jest.Mock;
const notify = notifyUsersOfLegalReleases as jest.Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

function fakeMailService() {
  return { sendMail: jest.fn() } as unknown as import('@/mail/mail.service').MailService;
}

const tosDoc = { slug: 'terms-of-service', title: 'Terms of Service', version: '2026-09-17' } as never;

beforeEach(() => {
  detect.mockReset();
  notify.mockReset().mockResolvedValue({ releasesProcessed: 1, usersNotified: 0, usersFailed: 0 });
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
  else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
});

describe('LegalReleaseBootService.onModuleInit', () => {
  it('never notifies when nothing changed, regardless of SaaS mode', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    detect.mockResolvedValue({ bootstrapped: [], changed: [] });

    await new LegalReleaseBootService(fakeMailService()).onModuleInit();

    expect(notify).not.toHaveBeenCalled();
  });

  it('never notifies a bootstrap-only release, even in SaaS mode', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    detect.mockResolvedValue({ bootstrapped: [tosDoc], changed: [] });

    await new LegalReleaseBootService(fakeMailService()).onModuleInit();

    expect(notify).not.toHaveBeenCalled();
  });

  it('kicks off notification for a real change in SaaS mode', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    detect.mockResolvedValue({ bootstrapped: [], changed: [tosDoc] });

    await new LegalReleaseBootService(fakeMailService()).onModuleInit();

    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('records the release but sends NO mail outside SaaS mode', async () => {
    delete process.env[BILLING_FLAG_NAME];
    detect.mockResolvedValue({ bootstrapped: [], changed: [tosDoc] });

    await new LegalReleaseBootService(fakeMailService()).onModuleInit();

    expect(detect).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('never throws when detection itself fails', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    detect.mockRejectedValue(new Error('DB unreachable'));

    await expect(new LegalReleaseBootService(fakeMailService()).onModuleInit()).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not let a rejected notification pass escape onModuleInit', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    detect.mockResolvedValue({ bootstrapped: [], changed: [tosDoc] });
    notify.mockRejectedValue(new Error('mail provider down'));

    await expect(new LegalReleaseBootService(fakeMailService()).onModuleInit()).resolves.toBeUndefined();
  });
});
