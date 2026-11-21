import { vi, type Mock } from 'vitest';
import { BadRequestException, ConflictException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { ActionRegistry } from './action-registry';
import { MAX_NOTE_LENGTH, registerAcceptManuallyAction } from './quote-manual-acceptance';
import * as persistence from '../persistence';
import * as archivePersistence from '../archive/persistence';
import * as inboundStorage from '../received-invoices/storage';
import { MAX_ATTACHMENT_BYTES } from '../attachments/attachments.service';

vi.mock('../persistence');
vi.mock('../archive/persistence');
vi.mock('../received-invoices/storage');
vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

import { logger } from '@/logger/logger.service';

/**
 * Direct coverage of the "accept-manually" handler itself - the same style
 * request-deposit.spec.ts already uses (resolve the handler off a bare `ActionRegistry`, call it with
 * a hand-built `ActionContext`), rather than going through the full `DocumentsService`: the generic
 * status/availableWhen 409 gates are already `documents.service.spec.ts`'s own job. This file is about
 * what makes THIS action distinct from an e-signature: note validation, actor recording, and never
 * touching the `Signature` model or `data`.
 */
const ACTOR = { id: 'user-1', name: 'Jane Doe', email: 'jane@example.com' };

function buildRegistry() {
  const registry = new ActionRegistry();
  registerAcceptManuallyAction(registry);
  return registry;
}

function updatedQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'quote-1',
    typeId: 'quote',
    status: 'accepted',
    data: { client: 'client-1' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('accept-manually (issue #421)', () => {
  afterEach(() => vi.resetAllMocks());

  // Issue #373 ("quotes with options") - `resolveChosenOption` reads the quote's own CURRENT `data`
  // off `findOwnedDocument`, never the request's own echo of it - a default fixture with no `option`
  // tags on any line (the overwhelming majority case, unchanged by this feature) so every
  // pre-existing test here keeps passing without knowing this handler now makes that extra read; the
  // option-specific tests below override it with a genuinely multi-option quote.
  beforeEach(() => {
    (persistence.findOwnedDocument as Mock).mockResolvedValue(
      updatedQuote({ status: 'sent', data: { client: 'client-1', lines: [{ description: 'Line' }] } }),
    );
  });

  it('transitions "sent" -> "accepted" via a compare-and-swap scoped to "sent", never "signed"', async () => {
    (persistence.updateDocumentStatus as Mock).mockResolvedValue(updatedQuote());
    const handler = buildRegistry().resolve('quote', 'accept-manually')!;

    const result = await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: { note: 'Accepted by phone on 2026-09-20.' },
      currentStatus: 'sent',
      actor: ACTOR,
    });

    // Issue #373 follow-up - `chosenOption` stays `undefined` (fewer than two options); the trailing
    // `expect.any(Date)` is `knownUpdatedAt` - the fix for the acceptance-vs-signature race (this
    // handler's own header): the CAS now also guards on the row not having changed since it was read.
    expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
      'company-1',
      'quote',
      'quote-1',
      'accepted',
      { fromStatuses: ['sent'], knownUpdatedAt: expect.any(Date) },
    );
    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'accepted' });
    expect(result.message).toContain('accepted manually');
  });

  describe('issue #373 - a quote offering 2+ options', () => {
    function multiOptionQuote(status = 'sent') {
      return updatedQuote({
        status,
        data: {
          client: 'client-1',
          lines: [
            { description: 'Basic line', unitPrice: 100, quantity: 1, option: 'Basic' },
            { description: 'Premium line', unitPrice: 200, quantity: 1, option: 'Premium' },
          ],
        },
      });
    }

    it('refuses with no option named at all', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(multiOptionQuote());
      const handler = buildRegistry().resolve('quote', 'accept-manually')!;

      await expect(
        handler({
          companyId: 'company-1',
          typeId: 'quote',
          documentId: 'quote-1',
          data: {},
          params: { note: 'Accepted by phone.' },
          currentStatus: 'sent',
          actor: ACTOR,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it("refuses an option that does not name one of the quote's own options", async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(multiOptionQuote());
      const handler = buildRegistry().resolve('quote', 'accept-manually')!;

      await expect(
        handler({
          companyId: 'company-1',
          typeId: 'quote',
          documentId: 'quote-1',
          data: {},
          params: { note: 'Accepted by phone.', option: 'Deluxe' },
          currentStatus: 'sent',
          actor: ACTOR,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('records the chosen option on the SAME compare-and-swap write, and in the archive manifest', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(multiOptionQuote());
      (persistence.updateDocumentStatus as Mock).mockResolvedValue(
        updatedQuote({ acceptedOption: 'Premium' }),
      );
      (archivePersistence.createManualAcceptanceArchive as Mock).mockResolvedValue({ id: 'archive-1' });
      const handler = buildRegistry().resolve('quote', 'accept-manually')!;

      const result = await handler({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'quote-1',
        data: {},
        params: { note: 'Accepted by phone.', option: 'Premium' },
        currentStatus: 'sent',
        actor: ACTOR,
      });

      expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
        'company-1',
        'quote',
        'quote-1',
        'accepted',
        { fromStatuses: ['sent'], acceptedOption: 'Premium', knownUpdatedAt: expect.any(Date) },
      );
      expect(result.message).toContain('Premium');

      const call = (archivePersistence.createManualAcceptanceArchive as Mock).mock.calls[0][0];
      const manifest = JSON.parse(Buffer.from(call.manifest).toString('utf8'));
      expect(manifest.option).toMatchObject({
        name: 'Premium',
        netMinor: 20000,
        grossMinor: 20000,
        lines: [{ description: 'Premium line' }],
      });
    });
  });

  it('trims the note and rejects an empty one - required, non-empty', async () => {
    const handler = buildRegistry().resolve('quote', 'accept-manually')!;

    await expect(
      handler({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'quote-1',
        data: {},
        params: { note: '   ' },
        currentStatus: 'sent',
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });

  it('rejects a note over the bounded length', async () => {
    const handler = buildRegistry().resolve('quote', 'accept-manually')!;
    const tooLong = 'x'.repeat(MAX_NOTE_LENGTH + 1);

    await expect(
      handler({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'quote-1',
        data: {},
        params: { note: tooLong },
        currentStatus: 'sent',
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });

  it('actually trims surrounding whitespace before persisting the note', async () => {
    (persistence.updateDocumentStatus as Mock).mockResolvedValue(updatedQuote());
    const handler = buildRegistry().resolve('quote', 'accept-manually')!;

    await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: { note: '  Accepted via email reply  ' },
      currentStatus: 'sent',
      actor: ACTOR,
    });

    const loggedDetails = (logger.audit as Mock).mock.calls[0][1].details;
    expect(loggedDetails.note).toBe('Accepted via email reply');
  });

  it('records the actor (id/name/email) in the audit log, never a caller-supplied identity', async () => {
    (persistence.updateDocumentStatus as Mock).mockResolvedValue(updatedQuote());
    const handler = buildRegistry().resolve('quote', 'accept-manually')!;

    await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: { note: 'Accepted by phone.' },
      currentStatus: 'sent',
      actor: ACTOR,
    });

    expect(logger.audit).toHaveBeenCalledWith(
      expect.stringContaining('manually'),
      expect.objectContaining({
        category: 'documents',
        userId: 'user-1',
        details: expect.objectContaining({
          method: 'manual',
          actorName: 'Jane Doe',
          actorEmail: 'jane@example.com',
        }),
      }),
    );
  });

  it('resolves only after the audit row is written', async () => {
    (persistence.updateDocumentStatus as Mock).mockResolvedValue(updatedQuote());
    let written!: () => void;
    (logger.audit as Mock).mockReturnValue(new Promise<void>((resolve) => (written = resolve)));
    const handler = buildRegistry().resolve('quote', 'accept-manually')!;

    let settled = false;
    const pending = handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: { note: 'Accepted by phone.' },
      currentStatus: 'sent',
      actor: ACTOR,
    }).then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logger.audit).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    written();
    await pending;
    expect(settled).toBe(true);
  });

  it('refuses without an authenticated actor - never records "who" as nobody', async () => {
    const handler = buildRegistry().resolve('quote', 'accept-manually')!;

    await expect(
      handler({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'quote-1',
        data: {},
        params: { note: 'Accepted by phone.' },
        currentStatus: 'sent',
        actor: undefined,
      }),
    ).rejects.toThrow(/authenticated actor/);
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });

  it('refuses a race lost to a concurrent status change - the compare-and-swap 409, never a silent double-accept', async () => {
    (persistence.updateDocumentStatus as Mock).mockRejectedValue(
      new ConflictException('Document "quote-1" is no longer in one of the expected statuses (sent).'),
    );
    const handler = buildRegistry().resolve('quote', 'accept-manually')!;

    await expect(
      handler({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'quote-1',
        data: {},
        params: { note: 'Accepted by phone.' },
        currentStatus: 'sent',
        actor: ACTOR,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('archives the manual acceptance (best-effort) - never blocks the action when archiving fails', async () => {
    (persistence.updateDocumentStatus as Mock).mockResolvedValue(updatedQuote());
    (archivePersistence.createManualAcceptanceArchive as Mock).mockRejectedValue(new Error('disk full'));
    const handler = buildRegistry().resolve('quote', 'accept-manually')!;

    const result = await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: { note: 'Accepted by phone.' },
      currentStatus: 'sent',
      actor: ACTOR,
    });

    expect(result.changed).toBe(true); // the acceptance itself still stands
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to archive'),
      expect.objectContaining({ category: 'documents' }),
    );
  });

  it('archives a manifest carrying method/actor/note/timestamp, never a signature-shaped field', async () => {
    (persistence.updateDocumentStatus as Mock).mockResolvedValue(updatedQuote());
    (archivePersistence.createManualAcceptanceArchive as Mock).mockResolvedValue({ id: 'archive-1' });
    const handler = buildRegistry().resolve('quote', 'accept-manually')!;

    await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: { note: 'Accepted by phone on 2026-09-20.' },
      currentStatus: 'sent',
      actor: ACTOR,
    });

    const call = (archivePersistence.createManualAcceptanceArchive as Mock).mock.calls[0][0];
    expect(call.companyId).toBe('company-1');
    expect(call.documentId).toBe('quote-1');
    const manifest = JSON.parse(Buffer.from(call.manifest).toString('utf8'));
    expect(manifest).toMatchObject({
      kind: 'manual-acceptance',
      actorId: 'user-1',
      actorName: 'Jane Doe',
      actorEmail: 'jane@example.com',
      note: 'Accepted by phone on 2026-09-20.',
    });
    expect(typeof manifest.acceptedAt).toBe('string');
    expect(Object.keys(manifest).some((k) => /sign|otp/i.test(k))).toBe(false);
  });

  describe('issue #364 - a proof file attached to the manual acceptance', () => {
    const PDF = Buffer.from('%PDF-1.7 signed paper scan');
    const PDF_REF = createHash('sha256').update(PDF).digest('hex');

    function run(attachment: unknown) {
      const handler = buildRegistry().resolve('quote', 'accept-manually')!;
      return handler({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'quote-1',
        data: {},
        params: { note: 'Signed paper returned by post.', attachment },
        currentStatus: 'sent',
        actor: ACTOR,
      });
    }

    beforeEach(() => {
      (persistence.updateDocumentStatus as Mock).mockResolvedValue(updatedQuote());
      (archivePersistence.createManualAcceptanceArchive as Mock).mockResolvedValue({ id: 'archive-1' });
    });

    it('archives the file in the SAME call as the manifest, which names it by hash', async () => {
      (inboundStorage.readInboundFile as Mock).mockResolvedValue(PDF);

      await run({ fileRef: PDF_REF, fileName: ' scan.pdf ', mime: 'application/pdf' });

      expect(inboundStorage.readInboundFile).toHaveBeenCalledWith('company-1', PDF_REF, 'application/pdf');
      expect(archivePersistence.createManualAcceptanceArchive).toHaveBeenCalledTimes(1);
      const call = (archivePersistence.createManualAcceptanceArchive as Mock).mock.calls[0][0];
      expect(call.attachment).toEqual({ mime: 'application/pdf', bytes: PDF });
      const manifest = JSON.parse(Buffer.from(call.manifest).toString('utf8'));
      expect(manifest.attachment).toEqual({
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        byteLength: PDF.length,
        sha256: PDF_REF,
      });
    });

    it('without a file, archives exactly as before: no attachment, no storage read', async () => {
      await run(undefined);

      expect(inboundStorage.readInboundFile).not.toHaveBeenCalled();
      const call = (archivePersistence.createManualAcceptanceArchive as Mock).mock.calls[0][0];
      expect(call.attachment).toBeUndefined();
      expect(JSON.parse(Buffer.from(call.manifest).toString('utf8')).attachment).toBeUndefined();
    });

    it('refuses a disallowed mime with a named 400, before any status write', async () => {
      const attempt = run({ fileRef: PDF_REF, fileName: 'invoice.xml', mime: 'application/xml' });

      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toThrow(/Unsupported attachment type "application\/xml"/);
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('refuses a file over the size cap with a named 413', async () => {
      const big = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1);
      const bigRef = createHash('sha256').update(big).digest('hex');
      (inboundStorage.readInboundFile as Mock).mockResolvedValue(big);

      await expect(
        run({ fileRef: bigRef, fileName: 'big.pdf', mime: 'application/pdf' }),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('refuses a reference that was never uploaded for this company', async () => {
      (inboundStorage.readInboundFile as Mock).mockResolvedValue(null);

      await expect(run({ fileRef: PDF_REF, fileName: 'scan.pdf', mime: 'application/pdf' })).rejects.toThrow(
        /not found for this company/,
      );
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });

    it('refuses bytes that do not hash to the reference, and a malformed reference', async () => {
      (inboundStorage.readInboundFile as Mock).mockResolvedValue(Buffer.from('other bytes'));
      await expect(run({ fileRef: PDF_REF, fileName: 'scan.pdf', mime: 'application/pdf' })).rejects.toThrow(
        /no longer matches its reference/,
      );
      await expect(
        run({ fileRef: '../etc/passwd', fileName: 'x.pdf', mime: 'application/pdf' }),
      ).rejects.toThrow(/file reference returned by the upload endpoint/);
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });
  });
});
