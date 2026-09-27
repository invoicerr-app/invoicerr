/**
 * Issue #373 follow-up, point 1 (owner's review): "an OTP signature can overwrite a manual
 * acceptance and bill the wrong option." `markSigned`'s own compare-and-swap used to pass `undefined`
 * for `fromStatuses` (an UNCONDITIONAL write) despite its own comment claiming "SAME compare-and-swap"
 * as the manual-acceptance path - so a manual acceptance of "Basic" and an OTP signature of "Premium",
 * both reading "sent" before either writes, could BOTH succeed, the OTP silently overwriting
 * `status`/`acceptedOption` back to "Premium" after the manual acceptance had already recorded "Basic".
 *
 * Real Postgres, no mocking of the CAS write itself: two genuinely concurrent calls
 * (`Promise.allSettled`) racing to move the SAME "sent" quote to two DIFFERENT accepted options,
 * through the two DIFFERENT acceptance paths this issue is about. Exactly one must win; the loser
 * must get a named `ConflictException` (409-shaped) and leave NO side effect at all - no Signature row
 * marked signed, no DOCUMENT_SIGNED webhook, no manual-acceptance archive row - never a silent
 * overwrite of the winner's own choice.
 *
 * Run MANY TIMES over fresh rows, never once: which side wins one particular round is genuine,
 * non-deterministic scheduling (real DB round trips racing each other), so a single round can land in
 * an ordering that happens to look fine even with the bug present (the OTP write landing first, before
 * the manual acceptance's own guarded write even runs). The invariant this test actually cares about
 * ("never both succeed") must hold on EVERY round; removing `fromStatuses: ['sent']` from
 * `markSigned`'s own `updateDocumentStatus` call (restoring the `undefined` this test guards against)
 * reliably surfaces a round where both succeed within a handful of iterations.
 */
import { ConflictException } from '@nestjs/common';
import { vi } from 'vitest';

import { DocumentArchiveKind, WebhookEvent } from '../../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

import { ActionRegistry } from '../actions/action-registry';
import { registerAcceptManuallyAction } from '../actions/quote-manual-acceptance';
import { generateOtpCode, hashOtpCode } from './otp';
import { generateSignatureToken } from './signature-token';
import { SignaturesService } from './signatures.service';

const ACTOR = { id: 'user-1', name: 'Jane Doe', email: 'jane@example.com' };
const ROUNDS = 15;

describe('quote acceptance race - manual acceptance vs. OTP signature (issue #373 follow-up, point 1)', () => {
  let companyId: string;

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Acceptance Race Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'Nowhereland', // deliberately unresolvable - keeps country-policy out of the way
        phone: '+33100000000',
        email: `acceptance-race-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.signature.deleteMany({ where: { companyId } });
    await prisma.documentArchive.deleteMany({ where: { companyId } });
    await prisma.documentInstance.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  /** One round: a fresh "sent" quote and a fresh, live Signature row for it, raced once. Returns
   *  what actually happened so the test can assert the invariant on every round. */
  async function runOneRound(): Promise<void> {
    const quote = await prisma.documentInstance.create({
      data: {
        companyId,
        typeId: 'quote',
        status: 'sent',
        displayNumber: 'QUOTE-RACE',
        data: {
          client: 'client-1',
          currency: 'EUR',
          lines: [
            { description: 'Basic line', quantity: 1, unitPrice: 100, option: 'Basic' },
            { description: 'Premium line', quantity: 1, unitPrice: 200, option: 'Premium' },
          ],
        },
      },
    });

    const { token, tokenHash } = generateSignatureToken();
    const code = generateOtpCode();
    const signature = await prisma.signature.create({
      data: {
        companyId,
        typeId: 'quote',
        documentId: quote.id,
        tokenHash,
        otpCodeHash: hashOtpCode(code),
        otpExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    const webhooks = { dispatch: vi.fn().mockResolvedValue(undefined) };
    const clientsService = { getClientById: vi.fn().mockResolvedValue(null) };
    const mailService = { sendForCompany: vi.fn().mockResolvedValue(undefined) };
    const documentsService = { renderInstancePdf: vi.fn() };
    const signaturesService = new SignaturesService(
      clientsService as never,
      mailService as never,
      webhooks as never,
      documentsService as never,
    );

    const registry = new ActionRegistry();
    registerAcceptManuallyAction(registry);
    const acceptManually = registry.resolve('quote', 'accept-manually')!;

    // THE RACE: both read the quote's own current "sent" status/options independently (each
    // handler's own `findOwnedDocument` call), then both attempt to write - one accepting "Basic"
    // manually, the other signing "Premium" via OTP.
    const [manualResult, signResult] = await Promise.allSettled([
      acceptManually({
        companyId,
        typeId: 'quote',
        documentId: quote.id,
        data: {},
        params: { note: 'Accepted by phone.', option: 'Basic' },
        currentStatus: 'sent',
        actor: ACTOR,
      }),
      signaturesService.verifyAndSign(token, code, 'Premium'),
    ]);

    // Exactly one must succeed - never both (the bug this test guards against), never neither.
    const outcomes = [manualResult.status, signResult.status];
    expect(outcomes.filter((s) => s === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((s) => s === 'rejected')).toHaveLength(1);

    const finalQuote = await prisma.documentInstance.findUniqueOrThrow({ where: { id: quote.id } });
    const finalSignature = await prisma.signature.findUniqueOrThrow({ where: { id: signature.id } });
    const archives = await prisma.documentArchive.findMany({
      where: { documentId: quote.id, kind: DocumentArchiveKind.ACCEPTANCE },
    });

    if (manualResult.status === 'fulfilled') {
      // Manual acceptance won: the stored fact is "Basic", nowhere overwritten by the OTP signature.
      expect(finalQuote.status).toBe('accepted');
      expect(finalQuote.acceptedOption).toBe('Basic');

      // The OTP signature LOST the race - it must get a named 409, not a silent success, and must
      // leave NO side effect of its own.
      expect(signResult.status).toBe('rejected');
      expect((signResult as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(finalSignature.signedAt).toBeNull();
      expect(finalSignature.chosenOption).toBeNull();
      expect(finalSignature.isActive).toBe(true); // never consumed by a signature that never took
      expect(webhooks.dispatch).not.toHaveBeenCalled();
    } else {
      // The OTP signature won: the stored fact is "Premium".
      expect(finalQuote.status).toBe('signed');
      expect(finalQuote.acceptedOption).toBe('Premium');
      expect(finalSignature.signedAt).not.toBeNull();
      expect(finalSignature.chosenOption).toBe('Premium');
      expect(webhooks.dispatch).toHaveBeenCalledWith(
        WebhookEvent.DOCUMENT_SIGNED,
        expect.objectContaining({ documentId: quote.id }),
      );

      // The manual acceptance LOST the race - a named 409, and no manual-acceptance archive row for
      // an acceptance that never actually stood (the audit log/archive write both happen AFTER the
      // compare-and-swap in quote-manual-acceptance.ts, so a lost CAS never reaches them).
      expect(manualResult.status).toBe('rejected');
      expect((manualResult as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(archives).toHaveLength(0);
    }
  }

  it(`never lets both acceptance paths win at once, over ${ROUNDS} independent races`, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await runOneRound();
    }
  });
});
