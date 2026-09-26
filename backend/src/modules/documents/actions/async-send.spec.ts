import { vi, type Mock } from 'vitest';
import { ConflictException } from '@nestjs/common';

import { WebhookEvent } from '../../../../prisma/generated/prisma/client';

import * as archiveOnSend from '../archive/archive-on-send';
import * as takeNumber from '../numbering/take-number';
import * as persistence from '../persistence';
import * as reportOnSend from '../reporting/report-on-send';
import { runAsyncSendAction } from './async-send';

vi.mock('../persistence');
vi.mock('../numbering/take-number');
vi.mock('../archive/archive-on-send');
vi.mock('../reporting/report-on-send');

/**
 * `runAsyncSendAction` in isolation — the shared two-phase engine every type's "send" now goes
 * through (quote-actions.ts, invoice-actions.ts, credit-note-actions.ts). Mocks `../persistence` and
 * `../numbering/take-number` at their own entry points (the same discipline documents.service.spec.ts
 * already holds), so this proves the ORCHESTRATION (which phase runs when, what it enqueues, what it
 * never touches, and — critically — WHEN it numbers) — never a re-implementation of any of it. The
 * `deliver`/`queueDispatcher`/`preflight` callbacks are plain jest mocks: no BullMQ, no Nest, no Redis
 * needed at all, exactly what a "job replayed by the worker" ought to be testable without.
 */
describe('runAsyncSendAction', () => {
  afterEach(() => vi.resetAllMocks());

  const baseInput = {
    companyId: 'company-1',
    typeId: 'quote',
    documentId: 'doc-1',
    data: { client: 'client-1' },
    params: { recipient: 'client@example.com' },
    numberOnEnqueue: true,
  };

  it('throws (never touches persistence) when called on a never-saved record — unreachable via availableWhen, but never trusted alone', async () => {
    const queueDispatcher = { enqueueAction: vi.fn() };
    const deliver = vi.fn();

    await expect(
      runAsyncSendAction({ ...baseInput, documentId: undefined, queueDispatcher, deliver }),
    ).rejects.toThrow(/has not been saved yet/);

    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
    expect(queueDispatcher.enqueueAction).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  describe('phase 1 — the record is "draft" or "send_failed": number (if declared), THEN enqueue, deliver NOTHING yet', () => {
    it.each([
      'draft',
      'send_failed',
    ])('from "%s": persists "sending", takes the number BEFORE enqueueing, and never calls deliver', async (status) => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status,
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
        number: null,
        displayNumber: null,
      });
      const callOrder: string[] = [];
      const queueDispatcher = {
        enqueueAction: vi.fn().mockImplementation(async () => {
          callOrder.push('enqueue');
        }),
      };
      (takeNumber.takeDocumentNumberForTransition as Mock).mockImplementation(async () => {
        callOrder.push('number');
        return { number: 3, displayNumber: 'QUOTE-2026-0003' };
      });
      const deliver = vi.fn();

      const result = await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver });

      expect(deliver).not.toHaveBeenCalled();
      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'quote',
        'doc-1',
        'sending',
        baseInput.data,
        ['draft', 'send_failed'],
      );
      // THE RACE THIS FIX CLOSES (see async-send.ts's own header): numbering must happen BEFORE
      // the job is enqueued, never after — a real worker can be faster than that.
      expect(callOrder).toEqual(['number', 'enqueue']);
      expect(takeNumber.takeDocumentNumberForTransition).toHaveBeenCalledWith('company-1', 'quote', 'doc-1');
      expect(queueDispatcher.enqueueAction).toHaveBeenCalledWith({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'doc-1',
        actionId: 'send',
        payload: { data: baseInput.data, params: baseInput.params },
      });
      // The number is on the response too — a caller (documents.service.ts's runAction) reading
      // this result sees it immediately, not only after its own (now merely defensive) hook.
      expect(result).toEqual({
        document: expect.objectContaining({
          id: 'doc-1',
          status: 'sending',
          number: 3,
          displayNumber: 'QUOTE-2026-0003',
        }),
        changed: true,
        message: 'Sending…',
      });
    });

    it('never numbers a type declaring `numberOnEnqueue: false` (expense: no `numbering` at all)', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'exp-1',
        typeId: 'expense',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as Mock).mockResolvedValue({
        id: 'exp-1',
        typeId: 'expense',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'expense',
        documentId: 'exp-1',
        numberOnEnqueue: false,
        queueDispatcher,
        deliver: vi.fn(),
      });

      expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
    });

    it('never re-numbers a record that already carries one (a "send_failed" retry keeps its number)', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'send_failed',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
        number: 3,
        displayNumber: 'QUOTE-2026-0003',
      });
      const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };

      const result = await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: vi.fn() });

      expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
      expect(result.document).toMatchObject({ number: 3, displayNumber: 'QUOTE-2026-0003' });
    });

    it('two concurrent "send" calls on the SAME draft: the loser 409s instead of both numbering and enqueueing', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      // Simulates the real `updateMany({ ..., status: { in: ['draft', 'send_failed'] } })`
      // compare-and-swap (persistence.ts) losing its second race: only the FIRST caller's write
      // actually flips "draft" to "sending", the second finds the row already moved on.
      let calls = 0;
      (persistence.upsertDocument as Mock).mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          return {
            id: 'doc-1',
            typeId: 'quote',
            status: 'sending',
            data: baseInput.data,
            createdAt: new Date(),
            updatedAt: new Date(),
            number: null,
            displayNumber: null,
          };
        }
        throw new ConflictException('Document "doc-1" is no longer in one of the expected statuses.');
      });
      (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue({
        number: 3,
        displayNumber: 'QUOTE-2026-0003',
      });
      const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };
      const deliver = vi.fn();

      const call = () => runAsyncSendAction({ ...baseInput, queueDispatcher, deliver });
      const results = await Promise.allSettled([call(), call()]);

      // Which of the two literally wins is a scheduling detail — what matters is that EXACTLY one
      // does, never both and never neither.
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      // The exact bug this closes: without the CAS, both calls would have taken a number and enqueued
      // their own job for the same document.
      expect(takeNumber.takeDocumentNumberForTransition).toHaveBeenCalledTimes(1);
      expect(queueDispatcher.enqueueAction).toHaveBeenCalledTimes(1);
      expect(deliver).not.toHaveBeenCalled();
    });

    // `onNumbered` — a generic, type-agnostic hook (see async-send.ts's own header on why this core
    // file never branches on `typeId`): invoice-actions.ts is the one REAL caller that supplies one
    // (Portugal's ATCUD, `actions/atcud-issuance.spec.ts` covers that fact itself) — this file's own
    // job is only "does the CORE call it, with the right arguments, at the right moment".
    describe('onNumbered', () => {
      function mockFreshNumbering() {
        (persistence.findOwnedDocument as Mock).mockResolvedValue({
          id: 'doc-1',
          typeId: 'quote',
          status: 'draft',
          data: baseInput.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        (persistence.upsertDocument as Mock).mockResolvedValue({
          id: 'doc-1',
          typeId: 'quote',
          status: 'sending',
          data: baseInput.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          number: null,
          displayNumber: null,
        });
        (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue({
          number: 3,
          displayNumber: 'QUOTE-2026-0003',
        });
      }

      it('is called, exactly once, right after a real number is won — with the winning number', async () => {
        mockFreshNumbering();
        const onNumbered = vi.fn().mockResolvedValue(undefined);
        const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };

        await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: vi.fn(), onNumbered });

        expect(onNumbered).toHaveBeenCalledTimes(1);
        expect(onNumbered).toHaveBeenCalledWith({
          companyId: 'company-1',
          typeId: 'quote',
          documentId: 'doc-1',
          numbered: { number: 3, displayNumber: 'QUOTE-2026-0003' },
        });
      });

      it('is never called for a "send_failed" retry that keeps its existing number — nothing was won', async () => {
        (persistence.findOwnedDocument as Mock).mockResolvedValue({
          id: 'doc-1',
          typeId: 'quote',
          status: 'send_failed',
          data: baseInput.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        (persistence.upsertDocument as Mock).mockResolvedValue({
          id: 'doc-1',
          typeId: 'quote',
          status: 'sending',
          data: baseInput.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          number: 3,
          displayNumber: 'QUOTE-2026-0003',
        });
        const onNumbered = vi.fn();

        await runAsyncSendAction({
          ...baseInput,
          queueDispatcher: { enqueueAction: vi.fn().mockResolvedValue(undefined) },
          deliver: vi.fn(),
          onNumbered,
        });

        expect(onNumbered).not.toHaveBeenCalled();
      });

      it('is never called when `numberOnEnqueue` is false - a type with no numbering at all (expense)', async () => {
        (persistence.findOwnedDocument as Mock).mockResolvedValue({
          id: 'doc-1',
          typeId: 'expense',
          status: 'draft',
          data: baseInput.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        (persistence.upsertDocument as Mock).mockResolvedValue({
          id: 'doc-1',
          typeId: 'expense',
          status: 'sending',
          data: baseInput.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const onNumbered = vi.fn();

        await runAsyncSendAction({
          ...baseInput,
          typeId: 'expense',
          numberOnEnqueue: false,
          queueDispatcher: { enqueueAction: vi.fn().mockResolvedValue(undefined) },
          deliver: vi.fn(),
          onNumbered,
        });

        expect(onNumbered).not.toHaveBeenCalled();
        expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
      });

      it('every EXISTING caller/spec keeps working unchanged when absent — a true no-op, not a required field', async () => {
        mockFreshNumbering();
        const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };

        await expect(
          runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: vi.fn() }),
        ).resolves.toMatchObject({ changed: true });
      });
    });

    it('runs an optional preflight BEFORE persisting, numbering, or enqueueing anything — a thrown preflight blocks all three', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: vi.fn() };
      const deliver = vi.fn();
      const preflight = vi.fn().mockRejectedValue(new Error('no transport configured'));

      await expect(
        runAsyncSendAction({ ...baseInput, typeId: 'invoice', queueDispatcher, deliver, preflight }),
      ).rejects.toThrow(/no transport configured/);

      expect(preflight).toHaveBeenCalled();
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
      expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
      expect(queueDispatcher.enqueueAction).not.toHaveBeenCalled();
    });

    it('a SUCCESSFUL preflight lets phase 1 proceed exactly as without one', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue(undefined);
      const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };
      const preflight = vi.fn().mockResolvedValue(undefined);

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'invoice',
        queueDispatcher,
        deliver: vi.fn(),
        preflight,
      });

      expect(preflight).toHaveBeenCalled();
      expect(queueDispatcher.enqueueAction).toHaveBeenCalled();
    });

    // Cross-border tax ("transfrontalier") — THE PLUMBING: a preflight that
    // RETURNS resolved field values (invoice-actions.ts's own cross-border resolution) REPLACES
    // `data` for the "sending" write AND the enqueued job payload, never just for a synchronous
    // check that then throws its own answer away. See `RunAsyncSendInput.preflight`'s own header.
    it('a preflight that RETURNS resolved data persists (and enqueues) THAT data — never the raw one it was called with', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const resolvedData = { client: 'client-1', lines: [{ vatRate: '0', __crossBorderCategory: 'AE' }] };
      (persistence.upsertDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: resolvedData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue(undefined);
      const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };
      const preflight = vi.fn().mockResolvedValue(resolvedData);

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'invoice',
        queueDispatcher,
        deliver: vi.fn(),
        preflight,
      });

      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'invoice',
        'doc-1',
        'sending',
        resolvedData, // NEVER baseInput.data — this is the whole point of the fix
        ['draft', 'send_failed'],
      );
      expect(queueDispatcher.enqueueAction).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { data: resolvedData, params: baseInput.params } }),
      );
    });

    it("a preflight returning `undefined` (the quote's, the credit note's — every existing caller) still persists the RAW data untouched", async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };
      const preflight = vi.fn().mockResolvedValue(undefined);

      await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: vi.fn(), preflight });

      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'quote',
        'doc-1',
        'sending',
        baseInput.data,
        ['draft', 'send_failed'],
      );
    });
  });

  describe('phase 2 — the record is already "sending" (the worker\'s own replay): deliver, then "sent", NEVER enqueue or number again', () => {
    it('calls deliver with the freshly-read document, then persists "sent" (status only — data untouched)', async () => {
      const sendingDocument = {
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
        number: 1,
        displayNumber: 'QUOTE-2026-0001',
      };
      (persistence.findOwnedDocument as Mock).mockResolvedValue(sendingDocument);
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({
        ...sendingDocument,
        status: 'sent',
      });
      const queueDispatcher = { enqueueAction: vi.fn() };
      const deliver = vi.fn().mockResolvedValue({ message: 'Sent to client@example.com.' });

      const result = await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver });

      expect(deliver).toHaveBeenCalledWith({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'doc-1',
        document: sendingDocument,
        data: baseInput.data,
        params: baseInput.params,
      });
      // `null, undefined, undefined`: no lastActionError, no transport reference, and no provider id
      // — this `deliver` result carries none of the two (see transport-registry.ts's own
      // `DocumentTransportResult.reference`/`.providerId`).
      expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
        'company-1',
        'quote',
        'doc-1',
        'sent',
        null,
        undefined,
        undefined,
      );
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
      expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
      expect(queueDispatcher.enqueueAction).not.toHaveBeenCalled();
      expect(result).toEqual({
        document: expect.objectContaining({ id: 'doc-1', status: 'sent' }),
        changed: true,
        message: 'Sent to client@example.com.',
      });
    });

    // National transports ("transports nationaux") — the "pdp" transport hands back a `reference`
    // (the deposit id) AND a `providerId` alongside `message`; this proves BOTH reach
    // `updateDocumentStatus` as `transportRef`/`channelProviderId`, on the SAME write that records
    // "sent" — see `DocumentInstance.transportRef`/`.channelProviderId`'s own schema comments and
    // `transports/pdp-transport.ts`'s own header. This is exactly what the post-deposit conformity
    // sweep (`conformity/`) later reads to know which channel this document actually went through.
    it('threads a deliver() `reference`/`providerId` through to updateDocumentStatus as `transportRef`/`channelProviderId`', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sent',
        transportRef: '375037',
        channelProviderId: 'pdp',
      });
      const queueDispatcher = { enqueueAction: vi.fn() };
      const deliver = vi.fn().mockResolvedValue({
        message: 'Deposited — deposit id 375037.',
        reference: '375037',
        providerId: 'pdp',
      });

      await runAsyncSendAction({ ...baseInput, typeId: 'invoice', queueDispatcher, deliver });

      expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
        'company-1',
        'invoice',
        'doc-1',
        'sent',
        null,
        '375037',
        'pdp',
      );
    });

    // Legal archiving — archiving now runs BEFORE "sent" is persisted, fed EXACTLY
    // what `deliver()` handed back, never invented. Deliberately reordered ahead of the status write
    // (see async-send.ts's own header, "The delivery guarantee"): the status write can now fail and be
    // retried indefinitely without ever losing the artifacts, because archiving already happened. See
    // `archive/archive-on-send.ts` for why this call itself can never throw or undo a delivery that
    // already succeeded.
    it('archives the artifacts deliver() returned, right after confirming delivery, BEFORE "sent" is persisted', async () => {
      const callOrder: string[] = [];
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.confirmDelivery as Mock).mockImplementation(async () => {
        callOrder.push('confirmDelivery');
      });
      (persistence.updateDocumentStatus as Mock).mockImplementation(async () => {
        callOrder.push('updateDocumentStatus');
        return { id: 'doc-1', status: 'sent' };
      });
      (archiveOnSend.archiveDeliveredArtifactsIfAny as Mock).mockImplementation(async () => {
        callOrder.push('archiveDeliveredArtifactsIfAny');
      });
      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }];
      const deliver = vi.fn().mockResolvedValue({ message: 'Sent.', artifacts });
      const queueDispatcher = { enqueueAction: vi.fn() };

      await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver });

      expect(callOrder).toEqual([
        'confirmDelivery',
        'archiveDeliveredArtifactsIfAny',
        'updateDocumentStatus',
      ]);
      expect(archiveOnSend.archiveDeliveredArtifactsIfAny).toHaveBeenCalledWith({
        companyId: 'company-1',
        documentId: 'doc-1',
        artifacts,
      });
    });

    it('still calls archiveDeliveredArtifactsIfAny (with artifacts: undefined) for a deliver() with nothing to archive', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'cn-1',
        typeId: 'credit-note',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({ id: 'cn-1', status: 'sent' });
      const deliver = vi.fn().mockResolvedValue({ message: undefined });
      const queueDispatcher = { enqueueAction: vi.fn() };

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'credit-note',
        documentId: 'cn-1',
        queueDispatcher,
        deliver,
      });

      expect(archiveOnSend.archiveDeliveredArtifactsIfAny).toHaveBeenCalledWith({
        companyId: 'company-1',
        documentId: 'cn-1',
        artifacts: undefined,
      });
    });

    // A NEW concept ("declaration"), never a transport — see `reporting/report-on-send.ts`'s
    // own header. Runs AFTER the "sent" write (same "after the fact is settled" ordering), generically
    // for every type/transport — this test proves the WIRING (call order + arguments), never the
    // obligation decision itself (that is `reporting/report-on-send.spec.ts`'s job).
    it('calls reportOnSendIfObligated AFTER "sent" is persisted, with the right (companyId, typeId, documentId)', async () => {
      const callOrder: string[] = [];
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as Mock).mockImplementation(async () => {
        callOrder.push('updateDocumentStatus');
        return { id: 'doc-1', status: 'sent' };
      });
      (archiveOnSend.archiveDeliveredArtifactsIfAny as Mock).mockImplementation(async () => {
        callOrder.push('archiveDeliveredArtifactsIfAny');
      });
      (reportOnSend.reportOnSendIfObligated as Mock).mockImplementation(async () => {
        callOrder.push('reportOnSendIfObligated');
      });
      const queueDispatcher = { enqueueAction: vi.fn(), enqueueReport: vi.fn() };
      const deliver = vi.fn().mockResolvedValue({ message: 'Sent.' });

      await runAsyncSendAction({ ...baseInput, typeId: 'invoice', queueDispatcher, deliver });

      // Archiving now happens BEFORE the "sent" write (see async-send.ts's own header, "The delivery
      // guarantee") — reporting still runs last, after the fact is fully settled.
      expect(callOrder).toEqual([
        'archiveDeliveredArtifactsIfAny',
        'updateDocumentStatus',
        'reportOnSendIfObligated',
      ]);
      expect(reportOnSend.reportOnSendIfObligated).toHaveBeenCalledWith({
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher,
      });
    });

    // THE MUTATION TARGET the task's own brief names: "a declarative failure breaks the invoice's
    // status" — a declarative-reporting failure must NEVER be able to change what `runAsyncSendAction`
    // hands back (the document is already "sent", genuinely, by the time this call happens). Since
    // `reportOnSendIfObligated` itself already NEVER throws (see that file's own header), this proves
    // the CALLER here does not additionally wrap it in anything that could turn a rejection into a
    // different outcome — a mutation removing that "never throws" guarantee (or awaiting it before
    // the "sent" write) is exactly what this test would catch.
    it('never lets a reportOnSendIfObligated failure change the returned result — the document stays "sent"', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({ id: 'doc-1', status: 'sent' });
      (reportOnSend.reportOnSendIfObligated as Mock).mockRejectedValue(
        new Error('should never surface here'),
      );
      const queueDispatcher = { enqueueAction: vi.fn(), enqueueReport: vi.fn() };
      const deliver = vi.fn().mockResolvedValue({ message: 'Sent.' });

      await expect(
        runAsyncSendAction({ ...baseInput, typeId: 'invoice', queueDispatcher, deliver }),
      ).rejects.toThrow('should never surface here');

      // The document was ALREADY, genuinely persisted "sent" before `reportOnSendIfObligated` ever
      // ran (see the call-order test just above) — this hypothetical rejection (which
      // `report-on-send.spec.ts` proves never actually happens in production: that file's own
      // "never throws" tests are the REAL guard) cannot retroactively un-send it. The real, load-
      // bearing proof that a declarative FAILURE (as opposed to this contrived rejection) never
      // touches the document's status lives one layer down, at the worker level:
      // `document-action.processor.spec.ts`'s own "records the terminal failure ... and NEVER
      // touches markSendFailed" — the ONLY function that could ever move a document to
      // "send_failed" in the first place.
      expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
        'company-1',
        'invoice',
        'doc-1',
        'sent',
        null,
        undefined,
        undefined,
      );
    });

    // THE MUTATION TARGET #2 lives in the CALLER (queue/processors/document-action.processor.ts and
    // its own `onFailed`/mark-send-failed.ts), not here — this test only pins down the OTHER half of
    // the contract: a `deliver` failure must propagate UNCAUGHT from this function, never be turned
    // into "send_failed" (or anything else) by `runAsyncSendAction` itself, so BullMQ's own retry
    // gets a real chance to run first.
    it('a deliver() failure propagates UNCAUGHT — never persisted as "sent", never turned into "send_failed" here', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: vi.fn() };
      const deliverError = new Error('SMTP connection refused');
      const deliver = vi.fn().mockRejectedValue(deliverError);

      await expect(runAsyncSendAction({ ...baseInput, queueDispatcher, deliver })).rejects.toBe(deliverError);

      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });
  });

  // THE DOUBLE-DELIVERY GUARD — a genuine double-click, a second browser tab, an HTTP client
  // retrying after a timeout, or BullMQ's own at-least-once redelivery of the SAME job, all reach the
  // phase-2 branch above with the record ALREADY "sending". Without this guard, `deliver()` would run
  // twice — a real second deposit/email, not a theoretical one. See async-send.ts's own header.
  describe('the delivery claim — refusing to call deliver() twice for the same document', () => {
    function sendingDocument(id = 'doc-1') {
      return {
        id,
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    /** A `deliver()` double that does not resolve until the test explicitly tells it to — the shape
     *  needed to prove a SECOND call sees the claim as still held WHILE the first is genuinely
     *  in-flight, not merely "called before the first happened to finish". */
    function deferredDeliver() {
      let resolve!: (value: { message: string }) => void;
      const promise = new Promise<{ message: string }>((res) => {
        resolve = res;
      });
      const deliver = vi.fn().mockReturnValue(promise);
      return { deliver, resolve };
    }

    it('a single caller (the ordinary case) runs deliver() exactly once', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(sendingDocument());
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({ id: 'doc-1', status: 'sent' });
      const deliver = vi.fn().mockResolvedValue({ message: 'Sent.' });

      await runAsyncSendAction({ ...baseInput, queueDispatcher: { enqueueAction: vi.fn() }, deliver });

      expect(deliver).toHaveBeenCalledTimes(1);
    });

    // THE DOUBLE-CLICK SPEC: a second call for the SAME document, made WHILE the first is still
    // genuinely inside deliver() (never yet resolved), must be refused immediately — never queued,
    // never eventually calling deliver() a second time once the first finishes.
    it('a second call for the SAME document made WHILE the first is still delivering is refused with a ConflictException — deliver() never runs twice', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(sendingDocument());
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({ id: 'doc-1', status: 'sent' });
      const { deliver, resolve } = deferredDeliver();

      const firstCall = runAsyncSendAction({
        ...baseInput,
        queueDispatcher: { enqueueAction: vi.fn() },
        deliver,
      });
      // The first call is now inside `deliver()` (its own promise is still pending) — a second,
      // concurrent call for the exact same document must see the claim already held.
      const secondCall = runAsyncSendAction({
        ...baseInput,
        queueDispatcher: { enqueueAction: vi.fn() },
        deliver,
      });

      await expect(secondCall).rejects.toThrow(/already being delivered/);
      expect(deliver).toHaveBeenCalledTimes(1);

      resolve({ message: 'Sent.' });
      await expect(firstCall).resolves.toMatchObject({ changed: true });
    });

    // A DIFFERENT document is never blocked by another one's own in-flight claim — the guard is keyed
    // per (companyId, typeId, documentId), never a single global flag.
    it("a concurrent call for a DIFFERENT document is never blocked by another one's own in-flight claim", async () => {
      (persistence.findOwnedDocument as Mock).mockImplementation((_c: string, _t: string, id: string) =>
        Promise.resolve(sendingDocument(id)),
      );
      (persistence.updateDocumentStatus as Mock).mockImplementation((_c, _t, id) =>
        Promise.resolve({ id, status: 'sent' }),
      );
      const { deliver: deliverOne, resolve: resolveOne } = deferredDeliver();
      const deliverTwo = vi.fn().mockResolvedValue({ message: 'Sent.' });

      const firstCall = runAsyncSendAction({
        ...baseInput,
        documentId: 'doc-1',
        queueDispatcher: { enqueueAction: vi.fn() },
        deliver: deliverOne,
      });
      const secondCall = runAsyncSendAction({
        ...baseInput,
        documentId: 'doc-2',
        queueDispatcher: { enqueueAction: vi.fn() },
        deliver: deliverTwo,
      });

      await expect(secondCall).resolves.toMatchObject({ changed: true });
      expect(deliverTwo).toHaveBeenCalledTimes(1);

      resolveOne({ message: 'Sent.' });
      await firstCall;
    });

    it("releases the claim when deliver() throws — a legitimate BullMQ retry is not blocked by its own predecessor's claim", async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(sendingDocument());
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({ id: 'doc-1', status: 'sent' });
      const deliverError = new Error('transient network error');
      const failingThenSucceeding = vi
        .fn()
        .mockRejectedValueOnce(deliverError)
        .mockResolvedValueOnce({ message: 'Sent.' });

      await expect(
        runAsyncSendAction({
          ...baseInput,
          queueDispatcher: { enqueueAction: vi.fn() },
          deliver: failingThenSucceeding,
        }),
      ).rejects.toBe(deliverError);

      // The immediate retry (a fresh call for the SAME document, exactly what BullMQ's own
      // attempts/backoff would do) is NOT blocked by the failed attempt's own claim — proving it was
      // genuinely released, not merely never taken.
      await expect(
        runAsyncSendAction({
          ...baseInput,
          queueDispatcher: { enqueueAction: vi.fn() },
          deliver: failingThenSucceeding,
        }),
      ).resolves.toMatchObject({ changed: true });
      expect(failingThenSucceeding).toHaveBeenCalledTimes(2);
    });

    // CROSS-PROCESS — the in-memory Set above only protects a single process (the default
    // WORKER_INLINE=true topology); `persistence.ts#claimDocumentTransition` is the guarantee that
    // also holds when the API and a separate BullMQ worker (or a replica of either) do NOT share one.
    it('consults persistence.claimDocumentTransition, scoped to this exact document and its own freshly-read updatedAt', async () => {
      const doc = sendingDocument();
      (persistence.findOwnedDocument as Mock).mockResolvedValue(doc);
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({ id: 'doc-1', status: 'sent' });
      (persistence.claimDocumentTransition as Mock).mockResolvedValue(1);
      const deliver = vi.fn().mockResolvedValue({ message: 'Sent.' });

      await runAsyncSendAction({ ...baseInput, queueDispatcher: { enqueueAction: vi.fn() }, deliver });

      expect(persistence.claimDocumentTransition).toHaveBeenCalledWith(
        'company-1',
        'quote',
        'doc-1',
        ['sending'],
        doc.updatedAt,
        'sending',
      );
    });

    it('a claim refused at the DATABASE level (count 0) refuses the send, even though nothing in THIS process holds the in-memory claim', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(sendingDocument());
      (persistence.claimDocumentTransition as Mock).mockResolvedValue(0);
      const deliver = vi.fn();

      await expect(
        runAsyncSendAction({ ...baseInput, queueDispatcher: { enqueueAction: vi.fn() }, deliver }),
      ).rejects.toThrow(/already being delivered/);

      expect(deliver).not.toHaveBeenCalled();
      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
    });
  });

  // THE CROSS-PROCESS DELIVERY-CONFIRMATION GUARANTEE — see async-send.ts's own header, "The delivery
  // guarantee". `inFlightDeliveries` above only ever proved a SINGLE process cannot deliver twice;
  // these tests prove the guarantee that survives a retry landing on a completely different one, with
  // no in-memory history of the first attempt at all.
  describe('confirmDelivery — the durable, cross-process fact that survives a "sent" write failing', () => {
    function sendingInvoice(id = 'doc-1') {
      return {
        id,
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    it('confirms delivery durably (with the reference/providerId deliver() returned) BEFORE the "sent" write, then archives, then writes "sent"', async () => {
      const callOrder: string[] = [];
      (persistence.findOwnedDocument as Mock).mockResolvedValue(sendingInvoice());
      (persistence.confirmDelivery as Mock).mockImplementation(async () => {
        callOrder.push('confirmDelivery');
      });
      (archiveOnSend.archiveDeliveredArtifactsIfAny as Mock).mockImplementation(async () => {
        callOrder.push('archiveDeliveredArtifactsIfAny');
      });
      (persistence.updateDocumentStatus as Mock).mockImplementation(async () => {
        callOrder.push('updateDocumentStatus');
        return { id: 'doc-1', status: 'sent' };
      });
      const deliver = vi.fn().mockResolvedValue({
        message: 'Deposited.',
        reference: 'ref-1',
        providerId: 'pdp',
      });

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'invoice',
        queueDispatcher: { enqueueAction: vi.fn() },
        deliver,
      });

      expect(persistence.confirmDelivery).toHaveBeenCalledWith(
        'company-1',
        'invoice',
        'doc-1',
        'ref-1',
        'pdp',
      );
      expect(callOrder).toEqual([
        'confirmDelivery',
        'archiveDeliveredArtifactsIfAny',
        'updateDocumentStatus',
      ]);
    });

    // THE EXACT SCENARIO FROM THIS FILE'S OWN HEADER, proven end to end: `deliver()` succeeds, the
    // SUBSEQUENT write fails, and a retry arrives on a process that shares NOTHING with the first —
    // no `inFlightDeliveries` entry (a brand-new module instance, via `vi.resetModules()`), no
    // in-memory record of ever having called `deliver()`. The only thing the retry has is what the
    // first attempt left in the (simulated) database: `deliveryConfirmedAt`/`transportRef`/
    // `channelProviderId`, durably written by `confirmDelivery` before its own process's "sent" write
    // ever failed. A test exercising only one process would prove exactly the thing that already
    // worked (the in-process `Set`) — this one proves the guarantee that did not exist before.
    it('a delivery that succeeds, then a "sent" write that fails, then a retry on a FRESH process (no shared memory) never calls deliver() again', async () => {
      const documentId = 'doc-cross-process';

      // --- "Process A" ---------------------------------------------------------------------------
      (persistence.findOwnedDocument as Mock).mockResolvedValue(sendingInvoice(documentId));
      (persistence.confirmDelivery as Mock).mockResolvedValue(undefined);
      (persistence.updateDocumentStatus as Mock).mockRejectedValue(new Error('DB hiccup'));
      const deliverProcessA = vi.fn().mockResolvedValue({
        message: 'Deposited — deposit id ref-1.',
        reference: 'ref-1',
        providerId: 'pdp',
      });

      await expect(
        runAsyncSendAction({
          ...baseInput,
          typeId: 'invoice',
          documentId,
          queueDispatcher: { enqueueAction: vi.fn() },
          deliver: deliverProcessA,
        }),
      ).rejects.toThrow('DB hiccup');

      expect(deliverProcessA).toHaveBeenCalledTimes(1);
      expect(persistence.confirmDelivery).toHaveBeenCalledTimes(1);
      expect(persistence.confirmDelivery).toHaveBeenLastCalledWith(
        'company-1',
        'invoice',
        documentId,
        'ref-1',
        'pdp',
      );
      // The status write threw, so this call's own error propagates — but its `finally` (async-send.ts)
      // already released the in-process claim before doing so: by the time "process B" runs below,
      // `inFlightDeliveries` holds NOTHING for this document, in THIS process or any other — exactly
      // what a genuinely separate process's own, never-touched Set would also show. The guarantee
      // below is therefore proven against the SAME condition a real second process would present, not
      // a contrived one.

      // --- "Process B" — a completely fresh top-level module instance (`vi.resetModules()` forces
      // `async-send.ts` itself, never mocked, to be re-evaluated from scratch: a brand-new
      // `inFlightDeliveries` Set that has NEVER held this — or any — key). `../persistence` stays the
      // SAME automocked object (vitest keeps a mocked module's own identity across a module-registry
      // reset — confirmed by `rendering/render-pdf.spec.ts`'s own comment on the identical behavior),
      // which is exactly right here: it is what lets this test reconfigure `findOwnedDocument` to
      // return PRECISELY what process A's own `confirmDelivery` call durably left in the (simulated)
      // database, the one and only channel a real second process would ever learn that fact through.
      vi.resetModules();
      const { runAsyncSendAction: runOnFreshProcess } = await import('./async-send.js');

      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        ...sendingInvoice(documentId),
        deliveryConfirmedAt: new Date(),
        transportRef: 'ref-1',
        channelProviderId: 'pdp',
      });
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({
        id: documentId,
        status: 'sent',
        transportRef: 'ref-1',
        channelProviderId: 'pdp',
      });
      // What the ORIGINAL bug would call a second time — a real second deposit. Must never run.
      const deliverProcessB = vi.fn();

      const result = await runOnFreshProcess({
        ...baseInput,
        typeId: 'invoice',
        documentId,
        queueDispatcher: { enqueueAction: vi.fn() },
        deliver: deliverProcessB,
      });

      expect(deliverProcessB).not.toHaveBeenCalled();
      // Still exactly the ONE call from process A — process B never durably "confirms" anything new,
      // because it never called `deliver()` in the first place.
      expect(persistence.confirmDelivery).toHaveBeenCalledTimes(1);
      expect(persistence.updateDocumentStatus).toHaveBeenLastCalledWith(
        'company-1',
        'invoice',
        documentId,
        'sent',
        null,
        'ref-1',
        'pdp',
      );
      expect(result.document).toMatchObject({ status: 'sent' });
    });

    // THE ACCEPTED RESIDUAL WINDOW — see async-send.ts's own header. When `confirmDelivery` itself
    // cannot be written despite its own bounded internal retries, this file falls back to exactly the
    // guarantee it had BEFORE `deliveryConfirmedAt` existed: the in-process claim stays held, so at
    // least a retry landing on THIS SAME process is refused loudly instead of silently delivering
    // again.
    it('falls back to the same-process claim when confirmDelivery itself exhausts its own retries — a same-process retry is still refused, never silently re-delivers', async () => {
      // A DEDICATED documentId — this test deliberately leaves its own in-process claim held (that is
      // exactly the fallback behavior under test), which must never leak into any OTHER test in this
      // file sharing the ordinary "company-1"/"invoice"/"doc-1" triple.
      const documentId = 'doc-confirm-exhausted';
      (persistence.findOwnedDocument as Mock).mockResolvedValue(sendingInvoice(documentId));
      (persistence.confirmDelivery as Mock).mockRejectedValue(new Error('Postgres unreachable'));
      const deliver = vi
        .fn()
        .mockResolvedValue({ message: 'Deposited.', reference: 'ref-1', providerId: 'pdp' });

      await expect(
        runAsyncSendAction({
          ...baseInput,
          typeId: 'invoice',
          documentId,
          queueDispatcher: { enqueueAction: vi.fn() },
          deliver,
        }),
      ).rejects.toThrow('Postgres unreachable');

      // confirmDelivery's own internal retry loop (3 attempts) tried more than once before giving up.
      expect((persistence.confirmDelivery as Mock).mock.calls.length).toBeGreaterThan(1);
      expect(deliver).toHaveBeenCalledTimes(1);

      // The claim was deliberately left held (never released on this failure path) — an immediate
      // same-process retry is refused rather than calling `deliver()` a second time.
      await expect(
        runAsyncSendAction({
          ...baseInput,
          typeId: 'invoice',
          documentId,
          queueDispatcher: { enqueueAction: vi.fn() },
          deliver,
        }),
      ).rejects.toThrow(/already being delivered/);
      expect(deliver).toHaveBeenCalledTimes(1); // still just the one real attempt
    });

    it('confirmDelivery transparently retries a transient failure and still calls deliver() only once', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue(sendingInvoice());
      (persistence.confirmDelivery as Mock)
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce(undefined);
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({ id: 'doc-1', status: 'sent' });
      const deliver = vi
        .fn()
        .mockResolvedValue({ message: 'Deposited.', reference: 'ref-1', providerId: 'pdp' });

      const result = await runAsyncSendAction({
        ...baseInput,
        typeId: 'invoice',
        queueDispatcher: { enqueueAction: vi.fn() },
        deliver,
      });

      expect(deliver).toHaveBeenCalledTimes(1);
      expect(persistence.confirmDelivery).toHaveBeenCalledTimes(2);
      expect(result.document).toMatchObject({ status: 'sent' });
    });

    it('a "send_failed" retry that ALREADY carries deliveryConfirmedAt (every BullMQ attempt spent on the final write alone) still never calls deliver() again', async () => {
      // Phase 1 re-entry from "send_failed" is out of this function's own "already sending" branch —
      // this test targets phase 2 directly, the branch that actually decides whether to call
      // `deliver()`, with a record that carries the durable mark from a past, genuinely successful
      // delivery (see schema.prisma's own comment: never cleared by a later "send_failed"/"sending"
      // cycle).
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        ...sendingInvoice(),
        deliveryConfirmedAt: new Date('2026-01-01T00:00:00Z'),
        transportRef: 'ref-old',
        channelProviderId: 'pdp',
      });
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({
        id: 'doc-1',
        status: 'sent',
        transportRef: 'ref-old',
        channelProviderId: 'pdp',
      });
      const deliver = vi.fn();

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'invoice',
        queueDispatcher: { enqueueAction: vi.fn() },
        deliver,
      });

      expect(deliver).not.toHaveBeenCalled();
      expect(persistence.confirmDelivery).not.toHaveBeenCalled();
      expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
        'company-1',
        'invoice',
        'doc-1',
        'sent',
        null,
        'ref-old',
        'pdp',
      );
    });
  });

  // The worker→API SSE bridge (`queue/document-events-publisher.ts`).
  // `events` is OPTIONAL (see `RunAsyncSendInput.events`'s own header) — every test ABOVE this block
  // omits it and must keep passing unchanged; these are the DEDICATED tests for the publish behavior
  // itself: publish only once the fact is genuinely ACQUIRED in Postgres, never before, never on a
  // failed write.
  describe('events — the SSE status nudge', () => {
    it('phase 1: publishes "sending" AFTER upsertDocument persists it, with the record\'s own id', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };
      const events = { publish: vi.fn().mockResolvedValue(undefined) };
      const callOrder: string[] = [];
      (persistence.upsertDocument as Mock).mockImplementation(async () => {
        callOrder.push('upsertDocument');
        return {
          id: 'doc-1',
          typeId: 'quote',
          status: 'sending',
          data: baseInput.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });
      events.publish.mockImplementation(async () => {
        callOrder.push('publish');
      });

      await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: vi.fn(), events });

      expect(events.publish).toHaveBeenCalledWith('company-1', {
        documentId: 'doc-1',
        typeId: 'quote',
        kind: 'sending',
      });
      expect(callOrder).toEqual(['upsertDocument', 'publish']);
    });

    it('phase 1: never publishes at all when upsertDocument itself throws — an unacquired fact is never announced', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as Mock).mockRejectedValue(new Error('DB unreachable'));
      const queueDispatcher = { enqueueAction: vi.fn() };
      const events = { publish: vi.fn() };

      await expect(
        runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: vi.fn(), events }),
      ).rejects.toThrow('DB unreachable');

      expect(events.publish).not.toHaveBeenCalled();
    });

    it('phase 1: never publishes when a preflight rejects — nothing was ever acquired', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: vi.fn() };
      const events = { publish: vi.fn() };
      const preflight = vi.fn().mockRejectedValue(new Error('no transport configured'));

      await expect(
        runAsyncSendAction({
          ...baseInput,
          typeId: 'invoice',
          queueDispatcher,
          deliver: vi.fn(),
          preflight,
          events,
        }),
      ).rejects.toThrow(/no transport configured/);

      expect(events.publish).not.toHaveBeenCalled();
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('phase 2: archives BEFORE updateDocumentStatus, then publishes "sent" right after the status write', async () => {
      const callOrder: string[] = [];
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as Mock).mockImplementation(async () => {
        callOrder.push('updateDocumentStatus');
        return { id: 'doc-1', typeId: 'quote', status: 'sent' };
      });
      (archiveOnSend.archiveDeliveredArtifactsIfAny as Mock).mockImplementation(async () => {
        callOrder.push('archiveDeliveredArtifactsIfAny');
      });
      const queueDispatcher = { enqueueAction: vi.fn() };
      const events = {
        publish: vi.fn().mockImplementation(async () => {
          callOrder.push('publish');
        }),
      };
      const deliver = vi.fn().mockResolvedValue({ message: 'Sent.' });

      await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver, events });

      expect(events.publish).toHaveBeenCalledWith('company-1', {
        documentId: 'doc-1',
        typeId: 'quote',
        kind: 'sent',
      });
      // Archiving moved ahead of the "sent" write (this file's own header, "The delivery guarantee")
      // so it can never be skipped by that write failing; the SSE nudge still only fires once "sent"
      // is genuinely acquired.
      expect(callOrder).toEqual(['archiveDeliveredArtifactsIfAny', 'updateDocumentStatus', 'publish']);
    });

    it('phase 2: never publishes when deliver() throws — an unacquired "sent" is never announced', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: vi.fn() };
      const events = { publish: vi.fn() };
      const deliver = vi.fn().mockRejectedValue(new Error('SMTP connection refused'));

      await expect(runAsyncSendAction({ ...baseInput, queueDispatcher, deliver, events })).rejects.toThrow(
        'SMTP connection refused',
      );

      expect(events.publish).not.toHaveBeenCalled();
    });

    it('never touches events at all when absent — every pre-existing caller keeps working unchanged', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };

      // No `events` field at all — this must not throw (optional chaining, never a hard dependency).
      await expect(runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: vi.fn() })).resolves.toEqual(
        expect.objectContaining({ document: expect.objectContaining({ status: 'sending' }) }),
      );
    });
  });

  // The generic "sent" webhook — DOCUMENT_SENT, replacing the old per-type
  // INVOICE_SENT/QUOTE_SENT. `webhooks` is OPTIONAL (see `RunAsyncSendInput.webhooks`'s own header)
  // — every test ABOVE this block omits it and must keep passing unchanged; these are the DEDICATED
  // tests for the dispatch itself: fire only once the fact is genuinely ACQUIRED in Postgres, never
  // before, never on a failed delivery, and NEVER let a dispatch failure undo (or even surface past)
  // an already-successful send.
  describe('webhooks — the generic "sent" webhook', () => {
    it('dispatches DOCUMENT_SENT AFTER updateDocumentStatus persists "sent" and AFTER the SSE publish (archiving already happened, earlier)', async () => {
      const callOrder: string[] = [];
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
        number: 7,
        displayNumber: 'INV-2026-0007',
      });
      (persistence.updateDocumentStatus as Mock).mockImplementation(async () => {
        callOrder.push('updateDocumentStatus');
        return {
          id: 'doc-1',
          typeId: 'invoice',
          status: 'sent',
          number: 7,
          displayNumber: 'INV-2026-0007',
        };
      });
      (archiveOnSend.archiveDeliveredArtifactsIfAny as Mock).mockImplementation(async () => {
        callOrder.push('archiveDeliveredArtifactsIfAny');
      });
      const events = {
        publish: vi.fn().mockImplementation(async () => {
          callOrder.push('publish');
        }),
      };
      const webhooks = {
        dispatch: vi.fn().mockImplementation(async () => {
          callOrder.push('webhooks.dispatch');
        }),
      };
      const deliver = vi.fn().mockResolvedValue({ message: 'Sent.' });
      const queueDispatcher = { enqueueAction: vi.fn() };

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'invoice',
        queueDispatcher,
        deliver,
        events,
        webhooks,
      });

      // Archiving now runs BEFORE the "sent" write (this file's own header, "The delivery guarantee")
      // — everything downstream of "sent" keeps its own relative order unchanged.
      expect(callOrder).toEqual([
        'archiveDeliveredArtifactsIfAny',
        'updateDocumentStatus',
        'publish',
        'webhooks.dispatch',
      ]);
      expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
      // Generic by construction: `document` is a FIXED key (never `{ invoice: sent }`) — a
      // deliberate contract, decided so a receiver never needs a per-type branch to find the row.
      expect(webhooks.dispatch).toHaveBeenCalledWith(WebhookEvent.DOCUMENT_SENT, {
        documentId: 'doc-1',
        typeId: 'invoice',
        companyId: 'company-1',
        occurredAt: expect.any(String),
        document: expect.objectContaining({ id: 'doc-1', status: 'sent', number: 7 }),
      });
    });

    it('never dispatches when deliver() throws — an unacquired "sent" is never announced', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: vi.fn() };
      const webhooks = { dispatch: vi.fn() };
      const deliver = vi.fn().mockRejectedValue(new Error('SMTP connection refused'));

      await expect(
        runAsyncSendAction({ ...baseInput, typeId: 'invoice', queueDispatcher, deliver, webhooks }),
      ).rejects.toThrow('SMTP connection refused');

      expect(webhooks.dispatch).not.toHaveBeenCalled();
    });

    it('never dispatches at phase 1 (enqueue) — only "sent" (phase 2) fires it', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: vi.fn().mockResolvedValue(undefined) };
      const webhooks = { dispatch: vi.fn() };

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'invoice',
        queueDispatcher,
        deliver: vi.fn(),
        webhooks,
      });

      expect(webhooks.dispatch).not.toHaveBeenCalled();
    });

    // THE MUTATION TARGET: a webhook ENDPOINT being down must never look
    // like the send itself failed — `WebhookDispatcherService.dispatch` (the production `webhooks`)
    // logs then RETHROWS (see that file's own header) exactly like every one of its EXISTING callers
    // (`company.service.ts`, `clients.service.ts`) expects to catch; this proves `runAsyncSendAction`
    // is that catcher for ITS OWN call, never letting the rejection reach BullMQ (which would
    // otherwise retry a job whose document was already, genuinely sent).
    it('a dispatch failure NEVER propagates — the document stays "sent", the result is unaffected', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sent',
      });
      const queueDispatcher = { enqueueAction: vi.fn() };
      const webhooks = { dispatch: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
      const deliver = vi.fn().mockResolvedValue({ message: 'Sent.' });

      const result = await runAsyncSendAction({
        ...baseInput,
        typeId: 'invoice',
        queueDispatcher,
        deliver,
        webhooks,
      });

      expect(result).toEqual({
        document: expect.objectContaining({ id: 'doc-1', status: 'sent' }),
        changed: true,
        message: 'Sent.',
      });
      expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
    });

    it('never touches the webhook emitter at all when absent — every pre-existing caller keeps working unchanged', async () => {
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as Mock).mockResolvedValue({ id: 'doc-1', status: 'sent' });
      const queueDispatcher = { enqueueAction: vi.fn() };
      const deliver = vi.fn().mockResolvedValue({ message: 'Sent.' });

      // No `webhooks` field at all — this must not throw (optional chaining, never a hard dependency).
      await expect(runAsyncSendAction({ ...baseInput, queueDispatcher, deliver })).resolves.toEqual(
        expect.objectContaining({ document: expect.objectContaining({ status: 'sent' }) }),
      );
    });
  });
});
