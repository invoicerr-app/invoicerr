/**
 * Real Prisma against whatever `DATABASE_URL` this test run resolves ("invoicerr_dev" in this repo's
 * own dev setup — neither test runner loads `.env.test` on its own, same posture
 * `company.service.spec.ts`'s own header documents), `TransferService`/`TransferExpirySweepRunner`
 * constructed directly with a fake `MailService` — the same "construct the service directly, fake
 * only the leaf mail transport" shape `danger.service.spec.ts` uses.
 */
import { vi } from 'vitest';

import { randomUUID } from 'node:crypto';

// Every test below drives `TransferService` through several SEQUENTIAL real Postgres round trips
// (OTP lookup/consume, a pending-transfer check, a user lookup, a company lookup, the transfer
// insert, sometimes a seat reservation and two more user lookups for the finalize mail) — there is
// no faster, event-driven signal to wait on instead of the promise itself, unlike a UI dialog whose
// close can be gated on intercepting its own mutation. On PR #427 (2026-09-23), one of these tests
// hit Vitest's own 5s default `testTimeout` with no underlying Prisma/pg error surfaced — the query
// was still queued, not failed, when the timeout fired — while 520 other spec files and every OTHER
// test in this same file passed, some already taking 400-2300ms for a similar chain of round trips.
// That is a shared CI runner's own transient latency on a real database connection, not a bug in this
// service: re-running this exact file alone, with the whole suite, and under deliberate CPU
// contention (taskset + a CPU-bound stress loop) never reproduced a stall tied to this file's own
// logic. `migration-fresh-schema.spec.ts`'s own header sets the same precedent for the same reason:
// headroom over the runner's 5s default so a slow CI runner does not turn a passing spec into a flaky
// one. 20s is generous over every real timing observed here without hiding an actual regression (a
// genuinely hung call still fails, just no longer on an arbitrary unit-test clock).
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';

import { findDangerOtp, mintDangerOtp } from '@/modules/danger/danger-otp.persistence';
import { generateOtpCode, hashOtpCode } from '@/modules/documents/signatures/otp';
import { BILLING_FLAG_NAME } from '@/modules/billing/billing-flag';
import prisma from '@/prisma/prisma.service';
import { CurrentUser } from '@/types/user';

import { TransferExpirySweepRunner } from './transfer-expiry-sweep-runner';
import {
  looksLikeEmailAddress,
  OWNERSHIP_TRANSFER_SUBSCRIPTION_BLOCKED,
  TransferService,
} from './transfer.service';

function fakeMailService() {
  return { sendForCompany: vi.fn().mockResolvedValue({ message: 'sent' }) };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function createUser(
  overrides: Partial<{ email: string; firstname: string; lastname: string; locale: string | null }> = {},
) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      firstname: overrides.firstname ?? 'Test',
      lastname: overrides.lastname ?? 'User',
      email: overrides.email ?? uniqueEmail('user'),
      locale: overrides.locale,
    },
  });
}

function asCurrentUser(user: {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
}): CurrentUser {
  return { ...user, accessToken: 'test-access-token' } as CurrentUser;
}

async function createCompany(overrides: Partial<{ language: string | null }> = {}) {
  return prisma.company.create({
    data: {
      name: `Transfer Test Co ${randomUUID()}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: uniqueEmail('company'),
      language: overrides.language,
    },
  });
}

/** Mints a real, live danger-zone OTP challenge for `companyId` — the exact row
 *  `verifyAndConsumeDangerOtp` reads — and returns the plaintext code to submit. */
async function mintOtp(companyId: string): Promise<string> {
  const code = generateOtpCode();
  await mintDangerOtp(companyId, hashOtpCode(code));
  return code;
}

async function cleanup(ids: { companyIds?: string[]; userIds?: string[] }) {
  if (ids.companyIds?.length) {
    await prisma.companyOwnershipTransfer.deleteMany({ where: { companyId: { in: ids.companyIds } } });
    await prisma.companySubscription.deleteMany({ where: { companyId: { in: ids.companyIds } } });
    await prisma.userCompany.deleteMany({ where: { companyId: { in: ids.companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: ids.companyIds } } });
  }
  if (ids.userIds?.length) {
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
  }
}

describe('TransferService', () => {
  const ORIGINAL_BILLING_FLAG = process.env[BILLING_FLAG_NAME];

  afterEach(() => {
    if (ORIGINAL_BILLING_FLAG === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = ORIGINAL_BILLING_FLAG;
  });

  describe('initiateTransfer — anti-enumeration', () => {
    it('returns the identical message whether or not the destination email has an account, and never creates a row for one that does not', async () => {
      const mail = fakeMailService();
      const service = new TransferService(mail as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });

      try {
        const otpForGhost = await mintOtp(company.id);
        const ghostResult = await service.initiateTransfer(
          company.id,
          asCurrentUser(owner),
          uniqueEmail('nobody-has-this'),
          otpForGhost,
        );

        const recipient = await createUser();
        const otpForReal = await mintOtp(company.id);
        const realResult = await service.initiateTransfer(
          company.id,
          asCurrentUser(owner),
          recipient.email,
          otpForReal,
        );

        expect(ghostResult).toEqual(realResult);

        const rows = await prisma.companyOwnershipTransfer.findMany({ where: { companyId: company.id } });
        expect(rows).toHaveLength(1);
        expect(rows[0].toUserId).toBe(recipient.id);
        expect(mail.sendForCompany).toHaveBeenCalledTimes(1); // never mailed for the ghost address

        await cleanup({ userIds: [recipient.id] });
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id] });
      }
    });

    it('never blocks its own response on the notification e-mail actually being sent — a real network wait on ONLY the "account exists" branch is itself a timing side-channel', async () => {
      let releaseMailSend: () => void = () => {};
      // Whether the gate has been opened — the ONE fact this test reads to know the response did not
      // wait for the send. It replaces a `Promise.race` against a 200ms `setTimeout`, which asked the
      // wrong question: it compared the mail send to a WALL CLOCK, so a CI worker whose Postgres
      // round-trips (this service really writes rows) took longer than 200ms reported 'timeout' and
      // failed a service that had behaved perfectly (run 35989078564, 2026-09-24, on a PR touching
      // e2e specs only). Nothing here measures time any more.
      let mailSendReleased = false;
      const mailGate = new Promise<void>((resolve) => {
        releaseMailSend = () => {
          mailSendReleased = true;
          resolve();
        };
      });
      const mail = { sendForCompany: vi.fn().mockImplementation(() => mailGate.then(() => ({}))) };
      const service = new TransferService(mail as never);
      const owner = await createUser();
      const company = await createCompany();
      const recipient = await createUser();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });

      try {
        const otp = await mintOtp(company.id);
        const resultPromise = service.initiateTransfer(
          company.id,
          asCurrentUser(owner),
          recipient.email,
          otp,
        );

        // The gate is still shut, so the mail send is still pending. Awaiting the response here is
        // therefore the whole test: it settles ONLY because `initiateTransfer` does `void
        // this.mailService.sendForCompany(...)` (transfer.service.ts) instead of awaiting it. Put the
        // `await` back into the service and this line never settles — vitest fails THIS test on its
        // own per-test timeout, naming it, which is the regression signal. It is a slower failure
        // than the stopwatch was, and a truthful one: it cannot fail for any other reason.
        await resultPromise;
        // The send was actually STARTED (a service that simply never mailed would also return fast)…
        expect(mail.sendForCompany).toHaveBeenCalledTimes(1);
        // …and the response came back while it was still in flight.
        expect(mailSendReleased).toBe(false);

        releaseMailSend();
        await resultPromise;
        await cleanup({ userIds: [recipient.id] });
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id] });
      }
    });

    it('rejects a wrong OTP and creates nothing, existing account or not', async () => {
      const service = new TransferService(fakeMailService() as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      await mintOtp(company.id); // mint a real one so a wrong guess actually has something to miss

      try {
        await expect(
          service.initiateTransfer(company.id, asCurrentUser(owner), uniqueEmail('x'), '00000000'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(await prisma.companyOwnershipTransfer.count({ where: { companyId: company.id } })).toBe(0);
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id] });
      }
    });

    it('rejects transferring to yourself', async () => {
      const service = new TransferService(fakeMailService() as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const otp = await mintOtp(company.id);

      try {
        await expect(
          service.initiateTransfer(company.id, asCurrentUser(owner), owner.email.toUpperCase(), otp),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id] });
      }
    });
  });

  /**
   * The actual defect this wiring fixes: every transfer mail used to ship in English no matter which
   * language a party's own account preference named — the four `buildOwnershipTransfer*Email` callers
   * never passed a `language` through at all.
   */
  describe('language wiring', () => {
    it("mails the recipient of a request in THEIR OWN locale, not the initiator's", async () => {
      const mail = fakeMailService();
      const service = new TransferService(mail as never);
      const owner = await createUser({ locale: 'de' });
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const recipient = await createUser({ locale: 'fr' });

      try {
        await service.initiateTransfer(
          company.id,
          asCurrentUser(owner),
          recipient.email,
          await mintOtp(company.id),
        );

        expect(mail.sendForCompany).toHaveBeenCalledWith(
          company.id,
          expect.objectContaining({
            to: recipient.email,
            subject: expect.stringContaining('souhaite vous transférer la propriété'),
          }),
        );
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });

    it("falls back to the transferred company's own language when the recipient has none", async () => {
      const mail = fakeMailService();
      const service = new TransferService(mail as never);
      const owner = await createUser();
      const company = await createCompany({ language: 'it' });
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const recipient = await createUser({ locale: null });

      try {
        await service.initiateTransfer(
          company.id,
          asCurrentUser(owner),
          recipient.email,
          await mintOtp(company.id),
        );

        expect(mail.sendForCompany).toHaveBeenCalledWith(
          company.id,
          expect.objectContaining({ subject: expect.stringContaining('desidera trasferirti la proprietà') }),
        );
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });

    it("mails each party of a finalized transfer in their own language, not the other party's", async () => {
      const mail = fakeMailService();
      const service = new TransferService(mail as never);
      const owner = await createUser({ locale: 'de' });
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const recipient = await createUser({ locale: 'fr' });
      await service.initiateTransfer(
        company.id,
        asCurrentUser(owner),
        recipient.email,
        await mintOtp(company.id),
      );
      const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
        where: { companyId: company.id },
      });
      mail.sendForCompany.mockClear();

      try {
        await service.acceptTransfer(transfer.id, recipient.id);

        // The new owner (French) and the former owner (German) each read the SAME event in a
        // different language — one call must not have leaked the other's.
        expect(mail.sendForCompany).toHaveBeenCalledWith(
          company.id,
          expect.objectContaining({ to: recipient.email, subject: expect.stringContaining(company.name) }),
        );
        const recipientCall = mail.sendForCompany.mock.calls.find(
          ([, opts]) => opts.to === recipient.email,
        )![1];
        const ownerCall = mail.sendForCompany.mock.calls.find(([, opts]) => opts.to === owner.email)![1];
        expect(recipientCall.html).not.toBe(ownerCall.html);
        expect(recipientCall.html).toMatch(/propriétaire/i); // French wording
        expect(recipientCall.html).not.toMatch(/eigentümer/i);
        expect(ownerCall.html).toMatch(/eigentümer/i); // German wording
        expect(ownerCall.html).not.toMatch(/propriétaire/i);
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });

    it('mails the initiating owner a cancellation receipt in their own locale', async () => {
      const mail = fakeMailService();
      const service = new TransferService(mail as never);
      const owner = await createUser({ locale: 'fr' });
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const recipient = await createUser();
      await service.initiateTransfer(
        company.id,
        asCurrentUser(owner),
        recipient.email,
        await mintOtp(company.id),
      );
      const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
        where: { companyId: company.id },
      });
      mail.sendForCompany.mockClear();

      try {
        await service.cancelTransfer(company.id, transfer.id);

        expect(mail.sendForCompany).toHaveBeenCalledWith(
          company.id,
          expect.objectContaining({ to: owner.email, subject: expect.stringContaining('annulé') }),
        );
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });
  });

  describe('initiateTransfer — at most one PENDING per company', () => {
    it('refuses a second initiation while one is already pending', async () => {
      const service = new TransferService(fakeMailService() as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const recipient1 = await createUser();
      const recipient2 = await createUser();

      try {
        await service.initiateTransfer(
          company.id,
          asCurrentUser(owner),
          recipient1.email,
          await mintOtp(company.id),
        );

        await expect(
          service.initiateTransfer(
            company.id,
            asCurrentUser(owner),
            recipient2.email,
            await mintOtp(company.id),
          ),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(await prisma.companyOwnershipTransfer.count({ where: { companyId: company.id } })).toBe(1);
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient1.id, recipient2.id] });
      }
    });
  });

  describe('initiateTransfer — subscription gate', () => {
    it('refuses to initiate when the subscription is PAST_DUE, named OWNERSHIP_TRANSFER_SUBSCRIPTION_BLOCKED', async () => {
      process.env[BILLING_FLAG_NAME] = 'true';
      const service = new TransferService(fakeMailService() as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      await prisma.companySubscription.create({
        data: {
          companyId: company.id,
          status: 'PAST_DUE',
          trialStartedAt: new Date(),
          trialEndsAt: new Date(),
        },
      });
      const otp = await mintOtp(company.id);

      try {
        const error = await service
          .initiateTransfer(company.id, asCurrentUser(owner), uniqueEmail('x'), otp)
          .catch((e) => e);
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.getResponse()).toMatchObject({ code: OWNERSHIP_TRANSFER_SUBSCRIPTION_BLOCKED });
        // The OTP was already consumed by the time the subscription gate ran — refused again on a
        // retry rather than silently accepted, since there is no live code left to check against.
        expect(await findDangerOtp(company.id)).toBeNull();
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id] });
      }
    });

    it('is a no-op outside hosted-billing mode — self-hosted never sees this gate', async () => {
      delete process.env[BILLING_FLAG_NAME];
      const service = new TransferService(fakeMailService() as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      await prisma.companySubscription.create({
        data: {
          companyId: company.id,
          status: 'PAST_DUE',
          trialStartedAt: new Date(),
          trialEndsAt: new Date(),
        },
      });
      const recipient = await createUser();
      const otp = await mintOtp(company.id);

      try {
        await expect(
          service.initiateTransfer(company.id, asCurrentUser(owner), recipient.email, otp),
        ).resolves.toBeDefined();
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });
  });

  describe('cancelTransfer', () => {
    it('marks a pending transfer CANCELED and notifies the initiating owner', async () => {
      const mail = fakeMailService();
      const service = new TransferService(mail as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const recipient = await createUser();
      await service.initiateTransfer(
        company.id,
        asCurrentUser(owner),
        recipient.email,
        await mintOtp(company.id),
      );
      const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
        where: { companyId: company.id },
      });
      mail.sendForCompany.mockClear();

      try {
        await service.cancelTransfer(company.id, transfer.id);

        const row = await prisma.companyOwnershipTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
        expect(row.status).toBe('CANCELED');
        expect(row.canceledAt).not.toBeNull();
        expect(mail.sendForCompany).toHaveBeenCalledWith(
          company.id,
          expect.objectContaining({ to: owner.email }),
        );
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });
  });

  describe('acceptTransfer — finalize', () => {
    it('promotes the recipient to OWNER, demotes the initiator to ADMIN, and attaches the recipient if they were not a member yet', async () => {
      const mail = fakeMailService();
      const service = new TransferService(mail as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const recipient = await createUser(); // not a member yet
      await service.initiateTransfer(
        company.id,
        asCurrentUser(owner),
        recipient.email,
        await mintOtp(company.id),
      );
      const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
        where: { companyId: company.id },
      });

      try {
        await service.acceptTransfer(transfer.id, recipient.id);

        const ownerMembership = await prisma.userCompany.findUniqueOrThrow({
          where: { userId_companyId: { userId: owner.id, companyId: company.id } },
        });
        const recipientMembership = await prisma.userCompany.findUniqueOrThrow({
          where: { userId_companyId: { userId: recipient.id, companyId: company.id } },
        });
        expect(ownerMembership.role).toBe('ADMIN');
        expect(recipientMembership.role).toBe('OWNER');

        const row = await prisma.companyOwnershipTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
        expect(row.status).toBe('ACCEPTED');
        expect(row.acceptedAt).not.toBeNull();

        // One mail to each party — see `buildOwnershipTransferFinalizedEmail`'s own header.
        expect(mail.sendForCompany).toHaveBeenCalledWith(
          company.id,
          expect.objectContaining({ to: recipient.email }),
        );
        expect(mail.sendForCompany).toHaveBeenCalledWith(
          company.id,
          expect.objectContaining({ to: owner.email }),
        );
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });

    it("refuses a caller who is not this transfer's own recipient", async () => {
      const service = new TransferService(fakeMailService() as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const recipient = await createUser();
      const impostor = await createUser();
      await service.initiateTransfer(
        company.id,
        asCurrentUser(owner),
        recipient.email,
        await mintOtp(company.id),
      );
      const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
        where: { companyId: company.id },
      });

      try {
        await expect(service.acceptTransfer(transfer.id, impostor.id)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id, impostor.id] });
      }
    });

    it('refuses (410) an expired transfer and lazily flips it to EXPIRED', async () => {
      const service = new TransferService(fakeMailService() as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const recipient = await createUser();
      await service.initiateTransfer(
        company.id,
        asCurrentUser(owner),
        recipient.email,
        await mintOtp(company.id),
      );
      const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
        where: { companyId: company.id },
      });
      await prisma.companyOwnershipTransfer.update({
        where: { id: transfer.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      try {
        await expect(service.acceptTransfer(transfer.id, recipient.id)).rejects.toBeInstanceOf(GoneException);
        const row = await prisma.companyOwnershipTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
        expect(row.status).toBe('EXPIRED');
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });

    it('refuses a transfer that is no longer pending (already accepted)', async () => {
      const service = new TransferService(fakeMailService() as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      const recipient = await createUser();
      await service.initiateTransfer(
        company.id,
        asCurrentUser(owner),
        recipient.email,
        await mintOtp(company.id),
      );
      const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
        where: { companyId: company.id },
      });
      await service.acceptTransfer(transfer.id, recipient.id);

      try {
        await expect(service.acceptTransfer(transfer.id, recipient.id)).rejects.toBeInstanceOf(
          ConflictException,
        );
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });
  });

  describe('acceptTransfer — seat reservation', () => {
    // An accepted transfer ADDS a member (the initiator stays, as ADMIN), and a seat is one user
    // account attached to the company whatever its role — so the arrival has to pass the same
    // capacity check every other membership-creating path passes. See `billing/seat-sync.ts`'s header.
    it('refuses to attach the recipient when the company has no free seat, and leaves the transfer PENDING', async () => {
      process.env[BILLING_FLAG_NAME] = 'true';
      const service = new TransferService(fakeMailService() as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
      // One bought seat, one member: full.
      await prisma.companySubscription.create({
        data: {
          companyId: company.id,
          status: 'ACTIVE',
          seats: 1,
          trialStartedAt: new Date(),
          trialEndsAt: new Date(),
        },
      });
      const recipient = await createUser(); // not a member yet
      await service.initiateTransfer(
        company.id,
        asCurrentUser(owner),
        recipient.email,
        await mintOtp(company.id),
      );
      const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
        where: { companyId: company.id },
      });

      try {
        const error = await service.acceptTransfer(transfer.id, recipient.id).catch((e) => e);
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error.getResponse()).toMatchObject({ code: 'NO_FREE_SEAT' });

        // THE COUNT: the company still holds exactly the members it bought seats for.
        expect(await prisma.userCompany.count({ where: { companyId: company.id } })).toBe(1);
        expect(
          await prisma.userCompany.findUnique({
            where: { userId_companyId: { userId: recipient.id, companyId: company.id } },
          }),
        ).toBeNull();

        // Nothing else moved either: the initiator is still OWNER and the request can still be
        // accepted once a seat is bought.
        const ownerMembership = await prisma.userCompany.findUniqueOrThrow({
          where: { userId_companyId: { userId: owner.id, companyId: company.id } },
        });
        expect(ownerMembership.role).toBe('OWNER');
        const row = await prisma.companyOwnershipTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
        expect(row.status).toBe('PENDING');
        expect(row.acceptedAt).toBeNull();
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });

    it('attaches the recipient and gives them a desk when a seat is free', async () => {
      process.env[BILLING_FLAG_NAME] = 'true';
      const service = new TransferService(fakeMailService() as never);
      const owner = await createUser();
      const company = await createCompany();
      await prisma.userCompany.create({
        data: { userId: owner.id, companyId: company.id, role: 'OWNER', seatIndex: 1 },
      });
      await prisma.companySubscription.create({
        data: {
          companyId: company.id,
          status: 'ACTIVE',
          seats: 2,
          trialStartedAt: new Date(),
          trialEndsAt: new Date(),
        },
      });
      const recipient = await createUser();
      await service.initiateTransfer(
        company.id,
        asCurrentUser(owner),
        recipient.email,
        await mintOtp(company.id),
      );
      const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
        where: { companyId: company.id },
      });

      try {
        await service.acceptTransfer(transfer.id, recipient.id);

        expect(await prisma.userCompany.count({ where: { companyId: company.id } })).toBe(2);
        const recipientMembership = await prisma.userCompany.findUniqueOrThrow({
          where: { userId_companyId: { userId: recipient.id, companyId: company.id } },
        });
        expect(recipientMembership.role).toBe('OWNER');
        // The desk the reservation hands out — the lowest free index, never left null the way a
        // membership created outside `withSeatReservation` was.
        expect(recipientMembership.seatIndex).toBe(2);
      } finally {
        await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
      }
    });
  });
});

describe('TransferExpirySweepRunner', () => {
  it('expires a PENDING transfer whose window has lapsed and notifies the initiating owner', async () => {
    const mail = fakeMailService();
    const transferService = new TransferService(mail as never);
    const owner = await createUser();
    const company = await createCompany();
    await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
    const recipient = await createUser();
    await transferService.initiateTransfer(
      company.id,
      asCurrentUser(owner),
      recipient.email,
      await mintOtp(company.id),
    );
    const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
      where: { companyId: company.id },
    });
    await prisma.companyOwnershipTransfer.update({
      where: { id: transfer.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    mail.sendForCompany.mockClear();

    try {
      const runner = new TransferExpirySweepRunner(mail as never);
      const result = await runner.runSweep();

      expect(result.expired).toBeGreaterThanOrEqual(1);
      const row = await prisma.companyOwnershipTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
      expect(row.status).toBe('EXPIRED');
      expect(mail.sendForCompany).toHaveBeenCalledWith(
        company.id,
        expect.objectContaining({ to: owner.email }),
      );

      // Membership is untouched by an expiry — nothing was ever accepted.
      const ownerMembership = await prisma.userCompany.findUniqueOrThrow({
        where: { userId_companyId: { userId: owner.id, companyId: company.id } },
      });
      expect(ownerMembership.role).toBe('OWNER');
    } finally {
      await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
    }
  });

  it('notifies the initiating owner of an expiry in their own locale', async () => {
    const mail = fakeMailService();
    const transferService = new TransferService(mail as never);
    const owner = await createUser({ locale: 'de' });
    const company = await createCompany();
    await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
    const recipient = await createUser();
    await transferService.initiateTransfer(
      company.id,
      asCurrentUser(owner),
      recipient.email,
      await mintOtp(company.id),
    );
    const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
      where: { companyId: company.id },
    });
    await prisma.companyOwnershipTransfer.update({
      where: { id: transfer.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    mail.sendForCompany.mockClear();

    try {
      const runner = new TransferExpirySweepRunner(mail as never);
      await runner.runSweep();

      expect(mail.sendForCompany).toHaveBeenCalledWith(
        company.id,
        expect.objectContaining({ to: owner.email, subject: expect.stringMatching(/abgelaufen/i) }),
      );
    } finally {
      await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
    }
  });

  it('leaves an untouched, non-expired PENDING transfer alone', async () => {
    const mail = fakeMailService();
    const transferService = new TransferService(mail as never);
    const owner = await createUser();
    const company = await createCompany();
    await prisma.userCompany.create({ data: { userId: owner.id, companyId: company.id, role: 'OWNER' } });
    const recipient = await createUser();
    await transferService.initiateTransfer(
      company.id,
      asCurrentUser(owner),
      recipient.email,
      await mintOtp(company.id),
    );
    const transfer = await prisma.companyOwnershipTransfer.findFirstOrThrow({
      where: { companyId: company.id },
    });

    try {
      const runner = new TransferExpirySweepRunner(mail as never);
      await runner.runSweep();

      const row = await prisma.companyOwnershipTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
      expect(row.status).toBe('PENDING');
    } finally {
      await cleanup({ companyIds: [company.id], userIds: [owner.id, recipient.id] });
    }
  });
});

describe('looksLikeEmailAddress', () => {
  // The recipient address is typed free-form; the check must stay linear whatever the input.
  it('accepts ordinary addresses and rejects the obvious malformations', () => {
    expect(looksLikeEmailAddress('owner@example.com')).toBe(true);
    expect(looksLikeEmailAddress('a.b+c@sub.example.co')).toBe(true);
    for (const bad of [
      '',
      'no-at.example.com',
      '@example.com',
      'user@',
      'user@nodot',
      'user@.com',
      'user@com.',
      'a@b@c.com',
      'sp ace@example.com',
    ]) {
      expect(looksLikeEmailAddress(bad)).toBe(false);
    }
  });

  it('answers a pathological input in linear time and rejects anything over 254 characters', () => {
    const pathological = `!@!${'.'.repeat(5_000)}`;
    const started = performance.now();
    expect(looksLikeEmailAddress(pathological)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
    expect(looksLikeEmailAddress(`${'a'.repeat(250)}@x.io`)).toBe(false);
  });
});
