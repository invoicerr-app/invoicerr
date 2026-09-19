/**
 * Real Prisma against whatever `DATABASE_URL` this test run resolves ("invoicerr_dev" in this repo's
 * own dev setup — jest never loads `.env.test`, same posture `company.service.spec.ts`'s own header
 * documents), `TransferService`/`TransferExpirySweepRunner` constructed directly with a fake
 * `MailService` — the same "construct the service directly, fake only the leaf mail transport" shape
 * `danger.service.spec.ts` uses.
 */
import { randomUUID } from 'node:crypto';

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
import { OWNERSHIP_TRANSFER_SUBSCRIPTION_BLOCKED, TransferService } from './transfer.service';

function fakeMailService() {
  return { sendForCompany: jest.fn().mockResolvedValue({ message: 'sent' }) };
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

async function createUser(overrides: Partial<{ email: string; firstname: string; lastname: string }> = {}) {
  return prisma.user.create({
    data: {
      id: randomUUID(),
      firstname: overrides.firstname ?? 'Test',
      lastname: overrides.lastname ?? 'User',
      email: overrides.email ?? uniqueEmail('user'),
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

async function createCompany() {
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
      const mailGate = new Promise<void>((resolve) => {
        releaseMailSend = resolve;
      });
      const mail = { sendForCompany: jest.fn().mockImplementation(() => mailGate.then(() => ({}))) };
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

        // The mail send never resolves during this race — if `initiateTransfer` awaited it before
        // responding, `resultPromise` could never win, and this test would time out rather than fail
        // cleanly. Winning here proves the send genuinely runs in the background.
        const winner = await Promise.race([
          resultPromise.then(() => 'transfer' as const),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 200)),
        ]);
        expect(winner).toBe('transfer');

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
