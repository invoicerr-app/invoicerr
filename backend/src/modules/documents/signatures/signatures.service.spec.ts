import { BadRequestException, ConflictException } from '@nestjs/common';

import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

import * as persistence from '../persistence';
import { hashSignatureToken } from './signature-token';
import { MAX_FAILED_ATTEMPTS, MAX_OTP_MINTS, OTP_WINDOW_MS } from './otp';
import { SignaturesService } from './signatures.service';

jest.mock('../persistence');

/**
 * `@/prisma/prisma.service` is mocked with a tiny IN-MEMORY table (not a bare `jest.fn()` per
 * method) — the same "mock the module boundary, not a re-implementation of Prisma" discipline
 * `share-links.service.spec.ts` already documents for the identical situation. This is what lets a
 * real round trip (mint -> fail x5 -> locked, or request -> otp -> sign) exercise the ACTUAL
 * `signature.persistence.ts` module, only the database itself is fake — including its atomic
 * `updateMany`-with-a-guard-condition semantics, which is exactly the part a hand-wired
 * `jest.fn().mockResolvedValue(...)` per call could never actually prove.
 */
jest.mock('@/prisma/prisma.service', () => {
  const rows: Array<Record<string, any>> = [];
  let nextId = 1;

  function matches(row: Record<string, any>, where: Record<string, any>): boolean {
    return Object.entries(where).every(([key, condition]) => {
      const value = row[key];
      if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
        if ('lt' in condition) return value < condition.lt;
        if ('gte' in condition) return value >= condition.gte;
        throw new Error(`Unsupported where condition for "${key}": ${JSON.stringify(condition)}`);
      }
      return value === condition;
    });
  }

  function applyData(row: Record<string, any>, data: Record<string, any>): void {
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && typeof value === 'object' && 'increment' in value) {
        row[key] = (row[key] ?? 0) + value.increment;
      } else {
        row[key] = value;
      }
    }
    row.updatedAt = new Date();
  }

  const signature = {
    create: jest.fn(async ({ data }: { data: Record<string, any> }) => {
      const row = {
        id: `sig-${nextId++}`,
        otpCodeHash: null,
        otpExpiresAt: null,
        otpFailedAttempts: 0,
        otpResendCount: 0,
        lockedAt: null,
        signedAt: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return { ...row };
    }),
    findUnique: jest.fn(async ({ where }: { where: Record<string, any> }) => {
      const row = rows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: Record<string, any> }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error(`no Signature "${JSON.stringify(where)}"`);
      return { ...row };
    }),
    findFirst: jest.fn(async ({ where }: { where: Record<string, any> }) => {
      const row = rows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    updateMany: jest.fn(
      async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const matched = rows.filter((r) => matches(r, where));
        for (const row of matched) applyData(row, data);
        return { count: matched.length };
      },
    ),
    update: jest.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error(`no Signature "${JSON.stringify(where)}"`);
      applyData(row, data);
      return { ...row };
    }),
  };

  // A company that HAS customised both system emails — stored in the single-brace vocabulary the shared
  // engine interpolates (`actions/email-template.ts`), and html, which is the only thing
  // `MailTemplate.body` has ever held. Individual tests below override this to prove the no-row-at-all
  // path (the shipped default applies) and the unknown-placeholder path; it is exported so `beforeEach`
  // can REINSTATE it, because `jest.clearAllMocks()` clears recorded calls but NOT implementations — an
  // overriding test would otherwise silently poison every test that runs after it.
  const defaultMailTemplateFindFirst = async ({ where }: { where: { type: string } }) =>
    where.type === 'SIGNATURE_REQUEST'
      ? {
          subject: 'Please sign {signatureNumber}',
          body: '<p>Open <a href="{signatureUrl}">here</a> to sign.</p>',
        }
      : { subject: 'Your code', body: '<p>Code: {otpCode}</p>' };

  return {
    __esModule: true,
    default: {
      signature,
      mailTemplate: { findFirst: jest.fn(defaultMailTemplateFindFirst) },
    },
    __rows: rows,
    __defaultMailTemplateFindFirst: defaultMailTemplateFindFirst,
  };
});

const SENT_QUOTE = {
  id: 'quote-1',
  typeId: 'quote',
  status: 'sent',
  data: { client: 'client-1' },
  createdAt: new Date(),
  updatedAt: new Date(),
  displayNumber: 'QUOTE-2026-0001',
};

function buildService(
  webhooks: { dispatch: jest.Mock } = { dispatch: jest.fn().mockResolvedValue(undefined) },
) {
  const clientsService = {
    getClientById: jest.fn().mockResolvedValue({ contactEmail: 'client@example.com' }),
  };
  const mailService = { sendMail: jest.fn().mockResolvedValue(undefined) };
  const service = new SignaturesService(clientsService as any, mailService as any, webhooks as any);
  return { service, clientsService, mailService, webhooks };
}

function rows(): Array<Record<string, any>> {
  return jest.requireMock('@/prisma/prisma.service').__rows;
}

describe('SignaturesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rows().length = 0;
    // See the mock factory's own comment: implementations survive `clearAllMocks`, so the stored-template
    // fixture is put back deliberately before every test.
    const mock = jest.requireMock('@/prisma/prisma.service');
    mock.default.mailTemplate.findFirst.mockImplementation(mock.__defaultMailTemplateFindFirst);
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(SENT_QUOTE);
    (persistence.updateDocumentStatus as jest.Mock).mockImplementation(
      async (_companyId: string, _typeId: string, id: string, status: string) => ({
        ...SENT_QUOTE,
        id,
        status,
      }),
    );
  });

  describe("requestSignature — the action handler's own effect", () => {
    it('mints a high-entropy token, persists ONLY its hash, and emails the RAW token in a URL', async () => {
      const { service, mailService } = buildService();

      const result = await service.requestSignature('company-1', 'quote', 'quote-1');

      expect(result.message).toContain('client@example.com');
      expect(rows()).toHaveLength(1);
      // >= 32 bytes of entropy hex-encoded -> >= 64 hex chars (signature-token.ts's own TOKEN_BYTES).
      const sentMail = mailService.sendMail.mock.calls[0][0];
      const urlMatch = /\/signature\/([0-9a-f]{64,})/.exec(sentMail.html);
      expect(urlMatch).not.toBeNull();
      const rawToken = urlMatch![1];

      // The row NEVER carries the raw token, only its hash — and the hash is not merely present, it
      // is the SAME hash `resolveActiveOrThrow` would compute from that raw token.
      expect(rows()[0].tokenHash).not.toBe(rawToken);
      expect(rows()[0].tokenHash).toBe(hashSignatureToken(rawToken));
      expect(rows()[0]).not.toHaveProperty('token');
      expect(JSON.stringify(rows())).not.toContain(rawToken);
    });

    it('refuses when the client has no contact email on file', async () => {
      const { service, clientsService } = buildService();
      clientsService.getClientById.mockResolvedValue({ contactEmail: null });

      await expect(service.requestSignature('company-1', 'quote', 'quote-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(rows()).toHaveLength(0);
    });

    it('deactivates a previously active signature for the same document before creating a fresh one', async () => {
      const { service } = buildService();

      await service.requestSignature('company-1', 'quote', 'quote-1');
      const firstToken = rows()[0].tokenHash;
      await service.requestSignature('company-1', 'quote', 'quote-1');

      expect(rows()).toHaveLength(2);
      const first = rows().find((r) => r.tokenHash === firstToken)!;
      expect(first.isActive).toBe(false);
      expect(rows()[1].isActive).toBe(true);
    });
  });

  describe('the public flow — resolve / otp / sign', () => {
    async function requestAndGetToken(service: SignaturesService, mailService: { sendMail: jest.Mock }) {
      await service.requestSignature('company-1', 'quote', 'quote-1');
      const html = mailService.sendMail.mock.calls[0][0].html as string;
      return /\/signature\/([0-9a-f]{64,})/.exec(html)![1];
    }

    it('resolves a fresh, valid signature request to its document type and display number', async () => {
      const { service, mailService } = buildService();
      const token = await requestAndGetToken(service, mailService);

      const view = await service.resolvePublicSignature(token);
      expect(view).toEqual({ typeId: 'quote', displayNumber: 'QUOTE-2026-0001' });
    });

    it('an unknown token gives the SAME generic refusal everywhere', async () => {
      const { service } = buildService();
      await expect(service.resolvePublicSignature('deadbeef'.repeat(8))).rejects.toThrow(
        'This signature request is invalid, expired, or already used.',
      );
      await expect(service.requestOtp('deadbeef'.repeat(8))).rejects.toThrow(
        'This signature request is invalid, expired, or already used.',
      );
      await expect(service.verifyAndSign('deadbeef'.repeat(8), '00000000')).rejects.toThrow(
        'This signature request is invalid, expired, or already used.',
      );
    });

    it('requestOtp mints a code, emails it, and stores ONLY its hash — never the code in the clear', async () => {
      const { service, mailService } = buildService();
      const token = await requestAndGetToken(service, mailService);
      mailService.sendMail.mockClear();

      await service.requestOtp(token);

      expect(mailService.sendMail).toHaveBeenCalledTimes(1);
      const html = mailService.sendMail.mock.calls[0][0].html as string;
      const codeMatch = /(\d{4}-\d{4})/.exec(html);
      expect(codeMatch).not.toBeNull();
      const displayedCode = codeMatch![1].replace('-', '');

      expect(rows()[0].otpCodeHash).not.toBe(displayedCode);
      expect(rows()[0].otpCodeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rows())).not.toContain(displayedCode);
    });

    it('the OTP window is exactly OTP_WINDOW_MS from the mint', async () => {
      const { service, mailService } = buildService();
      const token = await requestAndGetToken(service, mailService);
      const before = Date.now();
      await service.requestOtp(token);
      const after = Date.now();

      const expiresAt = new Date(rows()[0].otpExpiresAt).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + OTP_WINDOW_MS);
      expect(expiresAt).toBeLessThanOrEqual(after + OTP_WINDOW_MS);
    });

    it('mints a code at most MAX_OTP_MINTS times, ever — a further mint is refused distinctly', async () => {
      const { service, mailService } = buildService();
      const token = await requestAndGetToken(service, mailService);

      for (let i = 0; i < MAX_OTP_MINTS; i++) {
        await service.requestOtp(token);
      }
      expect(rows()[0].otpResendCount).toBe(MAX_OTP_MINTS);

      await expect(service.requestOtp(token)).rejects.toThrow(
        'The maximum number of verification codes has already been sent for this request.',
      );
      // The resend-cap refusal is DISTINCT wording from the generic block message — never conflated.
      await expect(service.requestOtp(token)).rejects.not.toThrow(
        'This signature request is invalid, expired, or already used.',
      );
      expect(rows()[0].otpResendCount).toBe(MAX_OTP_MINTS);
    });

    async function mintedCode(
      service: SignaturesService,
      mailService: { sendMail: jest.Mock },
      token: string,
    ) {
      mailService.sendMail.mockClear();
      await service.requestOtp(token);
      const html = mailService.sendMail.mock.calls[0][0].html as string;
      return /(\d{4})-(\d{4})/.exec(html)!.slice(1, 3).join('');
    }

    it('signs on the correct code, flips the document to "signed", and dispatches DOCUMENT_SIGNED', async () => {
      const { service, mailService, webhooks } = buildService();
      const token = await requestAndGetToken(service, mailService);
      const code = await mintedCode(service, mailService, token);

      const result = await service.verifyAndSign(token, code);

      expect(result.message).toBe('Document signed.');
      expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
        'company-1',
        'quote',
        'quote-1',
        'signed',
      );
      expect(rows()[0].signedAt).not.toBeNull();
      expect(rows()[0].isActive).toBe(false); // a signed row can never be replayed
      expect(webhooks.dispatch).toHaveBeenCalledWith(
        WebhookEvent.DOCUMENT_SIGNED,
        expect.objectContaining({ documentId: 'quote-1', typeId: 'quote', companyId: 'company-1' }),
      );
    });

    it('a second "sign" call with the SAME already-consumed code fails generically — no replay', async () => {
      const { service, mailService } = buildService();
      const token = await requestAndGetToken(service, mailService);
      const code = await mintedCode(service, mailService, token);

      await service.verifyAndSign(token, code);
      await expect(service.verifyAndSign(token, code)).rejects.toThrow(
        'This signature request is invalid, expired, or already used.',
      );
    });

    it('a wrong code fails generically and does not sign', async () => {
      const { service, mailService } = buildService();
      const token = await requestAndGetToken(service, mailService);
      await mintedCode(service, mailService, token);

      await expect(service.verifyAndSign(token, '00000000')).rejects.toThrow(
        'This signature request is invalid, expired, or already used.',
      );
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('an EXPIRED code fails generically, even though it was the right one at mint time', async () => {
      const { service, mailService } = buildService();
      const token = await requestAndGetToken(service, mailService);
      const code = await mintedCode(service, mailService, token);
      rows()[0].otpExpiresAt = new Date(Date.now() - 1000); // simulate the window having elapsed

      await expect(service.verifyAndSign(token, code)).rejects.toThrow(
        'This signature request is invalid, expired, or already used.',
      );
    });

    it('a code submitted before any OTP was ever minted fails generically (never a distinct hint)', async () => {
      const { service, mailService } = buildService();
      const token = await requestAndGetToken(service, mailService);

      await expect(service.verifyAndSign(token, '12345678')).rejects.toThrow(
        'This signature request is invalid, expired, or already used.',
      );
    });

    it('stores the OTP hashed — never the plaintext code — at every step', async () => {
      const { service, mailService } = buildService();
      const token = await requestAndGetToken(service, mailService);
      const code = await mintedCode(service, mailService, token);

      expect(rows()[0].otpCodeHash).not.toBe(code);
      await service.verifyAndSign(token, code);
      expect(JSON.stringify(rows())).not.toContain(code);
    });

    describe('the lifetime lock — the actual guarantee', () => {
      it(`locks PERMANENTLY at exactly MAX_FAILED_ATTEMPTS (${MAX_FAILED_ATTEMPTS}) wrong attempts`, async () => {
        const { service, mailService } = buildService();
        const token = await requestAndGetToken(service, mailService);
        await mintedCode(service, mailService, token);

        for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
          await expect(service.verifyAndSign(token, '00000000')).rejects.toThrow(
            'This signature request is invalid, expired, or already used.',
          );
        }

        expect(rows()[0].otpFailedAttempts).toBe(MAX_FAILED_ATTEMPTS);
        expect(rows()[0].lockedAt).not.toBeNull();
        expect(rows()[0].isActive).toBe(false);
      });

      it('a 6th attempt fails even with the CORRECT code — the lock is not merely "no more guesses left"', async () => {
        const { service, mailService } = buildService();
        const token = await requestAndGetToken(service, mailService);
        const code = await mintedCode(service, mailService, token);

        for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
          await expect(service.verifyAndSign(token, '00000000')).rejects.toThrow(BadRequestException);
        }

        // The correct code, submitted one attempt too late, still refuses — and the document was
        // never signed.
        await expect(service.verifyAndSign(token, code)).rejects.toThrow(
          'This signature request is invalid, expired, or already used.',
        );
        expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
      });

      it('re-arming the OTP (a fresh mint) does NOT reset the lifetime failed-attempt counter', async () => {
        const { service, mailService } = buildService();
        const token = await requestAndGetToken(service, mailService);
        await mintedCode(service, mailService, token);

        await expect(service.verifyAndSign(token, '00000000')).rejects.toThrow(BadRequestException);
        await expect(service.verifyAndSign(token, '11111111')).rejects.toThrow(BadRequestException);
        expect(rows()[0].otpFailedAttempts).toBe(2);

        // A second mint (well within MAX_OTP_MINTS) narrows the CURRENT code's window but must not
        // touch the counter above.
        await mintedCode(service, mailService, token);
        expect(rows()[0].otpFailedAttempts).toBe(2);

        // The remaining budget is 5 - 2 = 3, not reset to 5 — three more wrong guesses lock it.
        await expect(service.verifyAndSign(token, '00000000')).rejects.toThrow(BadRequestException);
        await expect(service.verifyAndSign(token, '00000000')).rejects.toThrow(BadRequestException);
        expect(rows()[0].lockedAt).toBeNull();
        await expect(service.verifyAndSign(token, '00000000')).rejects.toThrow(BadRequestException);
        expect(rows()[0].otpFailedAttempts).toBe(MAX_FAILED_ATTEMPTS);
        expect(rows()[0].lockedAt).not.toBeNull();
      });
    });

    it('refuses (409) to sign a document this same flow did not itself leave "sent"', async () => {
      const { service, mailService } = buildService();
      const token = await requestAndGetToken(service, mailService);
      const code = await mintedCode(service, mailService, token);
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({ ...SENT_QUOTE, status: 'draft' });

      await expect(service.verifyAndSign(token, code)).rejects.toBeInstanceOf(ConflictException);
    });

    it('sends BOTH an html and a text part — never an html-only message', async () => {
      const { service, mailService } = buildService();

      await service.requestSignature('company-1', 'quote', 'quote-1');

      const sent = mailService.sendMail.mock.calls[0][0];
      expect(sent.html).toContain('<a href=');
      // The company's stored template is html only; the text part is DERIVED from it — and carries the
      // LINK ITSELF, not merely the word "here": the href lives in an attribute, so a plain tag-strip
      // would hand a text-only reader a signature request with nothing to open.
      expect(sent.text).toMatch(/Open here \(.*\/signature\/[0-9a-f]{64,}\) to sign\./);
      expect(sent.subject).toBe('Please sign QUOTE-2026-0001');
    });

    it('falls back to the SHIPPED default when the company has no stored template — never a refusal', async () => {
      const { service, mailService } = buildService();
      const prisma = jest.requireMock('@/prisma/prisma.service').default;
      // A company whose rows were never created, or were deleted by the app reset: no longer a failure.
      prisma.mailTemplate.findFirst.mockResolvedValue(null);

      await expect(service.requestSignature('company-1', 'quote', 'quote-1')).resolves.toMatchObject({
        message: expect.stringContaining('client@example.com'),
      });

      const sent = mailService.sendMail.mock.calls[0][0];
      expect(sent.subject).toBe('Please sign document #QUOTE-2026-0001');
      expect(sent.html).toContain('Document Signature Required');
      expect(sent.html).toMatch(/\/signature\/[0-9a-f]{64,}/);
      expect(sent.text).toMatch(/\/signature\/[0-9a-f]{64,}/);
    });

    it('still delivers the OTP on the shipped default, carrying the display-form code in both parts', async () => {
      const { service, mailService } = buildService();
      const prisma = jest.requireMock('@/prisma/prisma.service').default;
      prisma.mailTemplate.findFirst.mockResolvedValue(null);

      await service.requestSignature('company-1', 'quote', 'quote-1');
      const token = /\/signature\/([0-9a-f]{64,})/.exec(mailService.sendMail.mock.calls[0][0].html)![1];
      mailService.sendMail.mockClear();

      await service.requestOtp(token);

      const sent = mailService.sendMail.mock.calls[0][0];
      expect(sent.subject).toBe('Your verification code');
      expect(sent.html).toMatch(/\d{4}-\d{4}/);
      expect(sent.text).toMatch(/\d{4}-\d{4}/);
      // Still only ever the DISPLAY form that travels; what is stored stays a hash.
      expect(rows()[0].otpCodeHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("a typo in a company's own template is WARNED about, never thrown — the email still goes out", async () => {
      const { service, mailService } = buildService();
      const prisma = jest.requireMock('@/prisma/prisma.service').default;
      prisma.mailTemplate.findFirst.mockResolvedValue({
        subject: 'Sign {SIGNATURE_NUMBER}',
        body: '<p>Open {{SIGNATURE_URL}}</p>',
      });

      await expect(service.requestSignature('company-1', 'quote', 'quote-1')).resolves.toBeDefined();

      // Both tokens belong to the retired vocabulary, so neither resolves — and BOTH are left exactly as
      // written rather than silently blanked, which is the whole point: a signature request that cannot
      // be interpolated still reaches its recipient, visibly imperfect instead of invisibly broken.
      const sent = mailService.sendMail.mock.calls[0][0];
      expect(sent.subject).toBe('Sign {SIGNATURE_NUMBER}');
      expect(sent.html).toContain('{SIGNATURE_URL}');
      expect(mailService.sendMail).toHaveBeenCalledTimes(1);
    });

    it('still signs even when the DOCUMENT_SIGNED webhook dispatch fails — the sign itself must not roll back', async () => {
      const webhooks = { dispatch: jest.fn().mockRejectedValue(new Error('webhook endpoint down')) };
      const { service, mailService } = buildService(webhooks);
      const token = await requestAndGetToken(service, mailService);
      const code = await mintedCode(service, mailService, token);

      const result = await service.verifyAndSign(token, code);
      expect(result.message).toBe('Document signed.');
      expect(rows()[0].signedAt).not.toBeNull();
    });
  });
});
