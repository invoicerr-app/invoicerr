/**
 * Issue #477, "an e-signature must bind to the exact version the client read".
 *
 * Real Postgres and real archive storage (a throwaway directory), no mock of anything this issue is
 * about: the quote goes through the real two-phase send (`actions/async-send.ts`), whose delivery is
 * archived by the real `archive-on-send.ts`; it is edited through the real save-draft
 * (`performSaveDraft`, with the exact `fromStatuses` `runAction` hands it); and every public call is
 * the real `SignaturesService`. Only the outside world is faked: the email delivery itself (`deliver`
 * returns PDF bytes that name the data they were "rendered" from, so two versions never collide) and
 * the mail/clients/webhook ports.
 *
 * The test that matters is the first one: edit a sent quote, then try to sign through the old link.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException, ConflictException } from '@nestjs/common';
import { vi } from 'vitest';

import { DocumentArchiveKind } from '../../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

import { runAsyncSendAction } from '../actions/async-send';
import { performSaveDraft } from '../actions/generic-actions';
import { registerAcceptManuallyAction } from '../actions/quote-manual-acceptance';
import { ActionRegistry } from '../actions/action-registry';
import { findManualAcceptanceArchive } from '../archive/persistence';
import { readArchivedArtifact } from '../archive/storage';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { allowedFromStatuses } from '../descriptors/lifecycle';
import { hashSignatureToken } from './signature-token';
import { DOCUMENT_CHANGED_CODE } from './signed-version';
import { SignaturesService } from './signatures.service';

const CLIENT_EMAIL = 'binding-client@example.com';

const QUOTE_V1 = {
  client: 'client-1',
  issueDate: '2026-09-27',
  currency: 'EUR',
  lines: [
    { description: 'Basic line', quantity: 1, unitPrice: 100, option: 'Basic', vatRate: '20' },
    { description: 'Premium line', quantity: 1, unitPrice: 300, option: 'Premium', vatRate: '20' },
  ],
};
// The edit: Premium's price changes. The option names do not, which is exactly what the #475 check
// (an option name that no longer exists) could never catch.
const QUOTE_V2 = {
  ...QUOTE_V1,
  lines: [QUOTE_V1.lines[0], { ...QUOTE_V1.lines[1], unitPrice: 900 }],
};

const SAVE_DRAFT_FROM = (() => {
  const descriptor = buildQuoteDescriptor();
  const saveDraft = descriptor.actions.find((a) => a.id === 'save-draft')!;
  return allowedFromStatuses(descriptor, saveDraft)!;
})();

/** The error body a Nest `HttpException` built from an object carries - where `code` lives. */
function errorCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return (response as { code?: string } | undefined)?.code;
}

describe('issue #477 - an e-signature is bound to the exact delivered version the client read', () => {
  let companyId: string;
  let archiveDir: string;
  const previousArchiveDir = process.env.DOCUMENTS_ARCHIVE_DIR;
  const previousArchiveStorage = process.env.ARCHIVE_STORAGE;

  const sentMail: Array<{ to: string; text: string }> = [];
  const mailService = {
    sendForCompany: vi.fn(async (_companyId: string, message: { to: string; text: string }) => {
      sentMail.push(message);
    }),
  };
  const clientsService = {
    getClientById: vi.fn(async () => ({ contactEmail: CLIENT_EMAIL, language: 'en' })),
  };
  const webhooks = { dispatch: vi.fn(async () => undefined) };
  const service = new SignaturesService(clientsService as never, mailService as never, webhooks as never);

  /** What the fake email delivery "attached": bytes naming the data they came from. */
  const deliver = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    message: 'Quote emailed.',
    artifacts: [
      {
        role: 'pdf' as const,
        mime: 'application/pdf' as const,
        bytes: new Uint8Array(Buffer.from(`%PDF-fake ${JSON.stringify(data)}`)),
      },
    ],
  }));

  beforeAll(async () => {
    archiveDir = mkdtempSync(join(tmpdir(), 'invoicerr-477-'));
    process.env.DOCUMENTS_ARCHIVE_DIR = archiveDir;
    delete process.env.ARCHIVE_STORAGE;
    const company = await prisma.company.create({
      data: {
        name: 'Signature Binding Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'Nowhereland', // deliberately unresolvable - keeps country-policy out of the way
        phone: '+33100000000',
        email: `signature-binding-${Date.now()}@example.com`,
      },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.signature.deleteMany({ where: { companyId } });
    await prisma.documentArchive.deleteMany({ where: { companyId } });
    await prisma.documentInstance.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    rmSync(archiveDir, { recursive: true, force: true });
    if (previousArchiveDir === undefined) delete process.env.DOCUMENTS_ARCHIVE_DIR;
    else process.env.DOCUMENTS_ARCHIVE_DIR = previousArchiveDir;
    if (previousArchiveStorage !== undefined) process.env.ARCHIVE_STORAGE = previousArchiveStorage;
  });

  beforeEach(() => {
    sentMail.length = 0;
    vi.clearAllMocks();
  });

  /** The real two-phase send: phase 1 (draft -> sending, numbered), then the worker's replay. */
  async function send(documentId: string, data: Record<string, unknown>): Promise<void> {
    const input = {
      companyId,
      typeId: 'quote',
      documentId,
      data,
      params: { recipient: CLIENT_EMAIL },
      queueDispatcher: { enqueueAction: vi.fn(async () => undefined) },
      deliver: deliver as never,
      numberOnEnqueue: true,
    };
    await runAsyncSendAction(input);
    await runAsyncSendAction(input);
    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
    expect(row.status).toBe('sent');
  }

  async function createSentQuote(): Promise<string> {
    const created = await performSaveDraft(companyId, 'quote', undefined, QUOTE_V1);
    const documentId = created.document!.id;
    await send(documentId, QUOTE_V1);
    return documentId;
  }

  /** Requests a signature and returns the raw token, read from the emailed link like a client would. */
  async function requestSignature(documentId: string): Promise<string> {
    await service.requestSignature(companyId, 'quote', documentId);
    const mail = sentMail.at(-1);
    const token = mail?.text.match(/\/signature\/([0-9a-f]{64})/)?.[1];
    expect(token, 'the request email carries the signing link').toBeDefined();
    return token as string;
  }

  /** Mints a code and returns it, read back from the OTP email. */
  async function requestCode(token: string): Promise<string> {
    await service.requestOtp(token);
    const match = sentMail.at(-1)?.text.match(/\b(\d{4})-(\d{4})\b/);
    expect(match, 'the OTP email carries the code').not.toBeNull();
    return `${match![1]}${match![2]}`;
  }

  async function deliveryArchives(documentId: string) {
    return prisma.documentArchive.findMany({
      where: { companyId, documentId, kind: DocumentArchiveKind.DELIVERY },
      orderBy: { archivedAt: 'asc' },
    });
  }

  it('edit a sent quote, then sign through the old link: refused, the quote stays unsigned, the code is not burned', async () => {
    const documentId = await createSentQuote();
    const token = await requestSignature(documentId);
    // The client opens the link and requests a code BEFORE the issuer edits: the worst case, a
    // live code in hand when the content moves.
    const code = await requestCode(token);

    // The issuer edits the sent quote (Premium 300 -> 900) through the real save-draft...
    await performSaveDraft(companyId, 'quote', documentId, QUOTE_V2, undefined, SAVE_DRAFT_FROM);
    // ...and sends it again, WITHOUT issuing a new signature request.
    await send(documentId, QUOTE_V2);
    const quote = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
    expect(quote.status).toBe('sent');

    const attempt = service.verifyAndSign(token, code, 'Premium');
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    expect(errorCode(await attempt.catch((e: unknown) => e))).toBe(DOCUMENT_CHANGED_CODE);
    expect((await service.resolvePublicSignature(token)).changed).toBe(true);

    const after = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
    expect(after.status).toBe('sent');
    expect(after.acceptedOption).toBeNull();
    const row = await prisma.signature.findUniqueOrThrow({ where: { tokenHash: hashSignatureToken(token) } });
    expect(row.signedAt).toBeNull();
    expect(row.otpFailedAttempts).toBe(0);
    expect(webhooks.dispatch).not.toHaveBeenCalled();
    const acceptances = await prisma.documentArchive.count({
      where: { companyId, documentId, kind: DocumentArchiveKind.ACCEPTANCE },
    });
    expect(acceptances).toBe(0);
  });

  it('an edit alone (the quote back in "draft", not sent again) already makes the old link unsignable', async () => {
    const documentId = await createSentQuote();
    const token = await requestSignature(documentId);
    const code = await requestCode(token);

    await performSaveDraft(companyId, 'quote', documentId, QUOTE_V2, undefined, SAVE_DRAFT_FROM);

    expect((await service.resolvePublicSignature(token)).changed).toBe(true);
    const attempt = service.verifyAndSign(token, code, 'Premium');
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    expect(errorCode(await attempt.catch((e: unknown) => e))).toBe(DOCUMENT_CHANGED_CODE);
    // And no fresh code is mailed for a request that can no longer be signed.
    const otp = service.requestOtp(token);
    await expect(otp).rejects.toBeInstanceOf(ConflictException);
    expect(errorCode(await otp.catch((e: unknown) => e))).toBe(DOCUMENT_CHANGED_CODE);
  });

  it('a change to the data that keeps the status "sent" (no save-draft involved) is caught all the same', async () => {
    const documentId = await createSentQuote();
    const token = await requestSignature(documentId);
    const code = await requestCode(token);

    await prisma.documentInstance.update({ where: { id: documentId }, data: { data: QUOTE_V2 } });

    const attempt = service.verifyAndSign(token, code, 'Premium');
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    expect(errorCode(await attempt.catch((e: unknown) => e))).toBe(DOCUMENT_CHANGED_CODE);
  });

  it('sending again delivers and archives the edited quote: a new version, a new request, and that one signs', async () => {
    const documentId = await createSentQuote();
    const oldToken = await requestSignature(documentId);
    expect(deliver).toHaveBeenCalledTimes(1);

    await performSaveDraft(companyId, 'quote', documentId, QUOTE_V2, undefined, SAVE_DRAFT_FROM);
    await send(documentId, QUOTE_V2);

    // The re-send really delivered (before this fix, `deliveryConfirmedAt` from the first send made
    // phase 2 skip `deliver()`, so the edit was never emailed nor archived).
    expect(deliver).toHaveBeenCalledTimes(2);
    const archives = await deliveryArchives(documentId);
    expect(archives).toHaveLength(2);
    const [v1Archive, v2Archive] = archives;
    expect(v2Archive.contentHash).not.toBe(v1Archive.contentHash);

    const newToken = await requestSignature(documentId);
    // The new request supersedes the old link outright.
    await expect(service.resolvePublicSignature(oldToken)).rejects.toBeInstanceOf(BadRequestException);

    const view = await service.resolvePublicSignature(newToken);
    expect(view.changed).toBe(false);
    expect(view.version).toEqual({ archiveId: v2Archive.id, contentHash: v2Archive.contentHash });
    // The options listed are the bound version's: Premium at 900 (+20% VAT), not the 300 of v1.
    expect(view.options?.find((o) => o.name === 'Premium')?.grossMinor).toBe(108000);

    // The page shows the PDF of the version the request is bound to, byte for byte.
    const pdf = await service.getPublicDocument(newToken);
    const expectedPdf = await readArchivedArtifact(v2Archive.uri, 'pdf', 'application/pdf');
    expect(pdf.bytes.equals(expectedPdf!)).toBe(true);
    expect(pdf.bytes.toString()).toContain('"unitPrice":900');

    const code = await requestCode(newToken);
    await service.verifyAndSign(newToken, code, 'Premium');

    const signed = await prisma.documentInstance.findUniqueOrThrow({ where: { id: documentId } });
    expect(signed.status).toBe('signed');
    expect(signed.acceptedOption).toBe('Premium');

    // The signature record names the version signed...
    const row = await prisma.signature.findUniqueOrThrow({
      where: { tokenHash: hashSignatureToken(newToken) },
    });
    expect(row.deliveryArchiveId).toBe(v2Archive.id);
    expect(row.deliveryContentHash).toBe(v2Archive.contentHash);

    // ...and so does the ACCEPTANCE archive, in its own bytes, linked to that exact DELIVERY archive.
    const acceptance = await prisma.documentArchive.findFirstOrThrow({
      where: { companyId, documentId, kind: DocumentArchiveKind.ACCEPTANCE },
    });
    expect(acceptance.parentArchiveId).toBe(v2Archive.id);
    const manifestBytes = await readArchivedArtifact(acceptance.uri, 'e-signature', 'application/json');
    const manifest = JSON.parse(manifestBytes!.toString('utf8'));
    expect(manifest).toMatchObject({
      kind: 'e-signature',
      documentId,
      signatureId: row.id,
      deliveredVersion: { archiveId: v2Archive.id, contentHash: v2Archive.contentHash },
      option: { name: 'Premium', grossMinor: 108000 },
    });
    // The e-signature archive is never mistaken for a manual acceptance.
    expect(await findManualAcceptanceArchive(companyId, documentId)).toBeNull();
  });

  it('refuses to issue a request when the latest send has no archived PDF yet (archiving failed, retry pending)', async () => {
    const documentId = await createSentQuote();
    // The latest delivery was confirmed AFTER the only archive was written: that archive is an
    // earlier send's, not the one the client holds now.
    await prisma.documentInstance.update({
      where: { id: documentId },
      data: { deliveryConfirmedAt: new Date(Date.now() + 60_000) },
    });

    await expect(service.requestSignature(companyId, 'quote', documentId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await prisma.signature.count({ where: { documentId } })).toBe(0);
    expect(sentMail).toHaveLength(0);
  });

  it('refuses to issue a request for a sent quote with no DELIVERY archive at all', async () => {
    const created = await performSaveDraft(companyId, 'quote', undefined, QUOTE_V1);
    const documentId = created.document!.id;
    await prisma.documentInstance.update({ where: { id: documentId }, data: { status: 'sent' } });

    await expect(service.requestSignature(companyId, 'quote', documentId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await prisma.signature.count({ where: { documentId } })).toBe(0);
  });

  it('a request created before version binding existed can no longer be signed', async () => {
    const documentId = await createSentQuote();
    const token = await requestSignature(documentId);
    await prisma.signature.update({
      where: { tokenHash: hashSignatureToken(token) },
      data: {
        deliveryArchiveId: null,
        deliveryContentHash: null,
        documentData: undefined,
        documentDataHash: null,
      },
    });

    expect((await service.resolvePublicSignature(token)).changed).toBe(true);
    await expect(service.requestOtp(token)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.getPublicDocument(token)).rejects.toBeInstanceOf(ConflictException);
  });

  it('manual acceptance names the delivered version it refers to in its own manifest', async () => {
    const documentId = await createSentQuote();
    const [archive] = await deliveryArchives(documentId);

    const registry = new ActionRegistry();
    registerAcceptManuallyAction(registry);
    await registry.resolve('quote', 'accept-manually')!({
      companyId,
      typeId: 'quote',
      documentId,
      data: {},
      params: { note: 'Accepted by phone.', option: 'Basic' },
      currentStatus: 'sent',
      actor: { id: 'user-1', name: 'Jane Doe', email: 'jane@example.com' },
    });

    const manifest = await findManualAcceptanceArchive(companyId, documentId);
    expect(manifest?.deliveredVersion).toEqual({ archiveId: archive.id, contentHash: archive.contentHash });
  });
});
