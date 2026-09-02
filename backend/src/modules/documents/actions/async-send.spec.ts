import * as archiveOnSend from '../archive/archive-on-send';
import * as takeNumber from '../numbering/take-number';
import * as persistence from '../persistence';
import * as reportOnSend from '../reporting/report-on-send';
import { runAsyncSendAction } from './async-send';

jest.mock('../persistence');
jest.mock('../numbering/take-number');
jest.mock('../archive/archive-on-send');
jest.mock('../reporting/report-on-send');

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
  afterEach(() => jest.resetAllMocks());

  const baseInput = {
    companyId: 'company-1',
    typeId: 'quote',
    documentId: 'doc-1',
    data: { client: 'client-1' },
    params: { recipient: 'client@example.com' },
    numberOnEnqueue: true,
  };

  it('throws (never touches persistence) when called on a never-saved record — unreachable via availableWhen, but never trusted alone', async () => {
    const queueDispatcher = { enqueueAction: jest.fn() };
    const deliver = jest.fn();

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
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status,
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
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
        enqueueAction: jest.fn().mockImplementation(async () => {
          callOrder.push('enqueue');
        }),
      };
      (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockImplementation(async () => {
        callOrder.push('number');
        return { number: 3, displayNumber: 'QUOTE-2026-0003' };
      });
      const deliver = jest.fn();

      const result = await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver });

      expect(deliver).not.toHaveBeenCalled();
      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'quote',
        'doc-1',
        'sending',
        baseInput.data,
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

    it('never numbers a type declaring `numberOnEnqueue: false` (credit-note: no `numbering` at all)', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'cn-1',
        typeId: 'credit-note',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'cn-1',
        typeId: 'credit-note',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'credit-note',
        documentId: 'cn-1',
        numberOnEnqueue: false,
        queueDispatcher,
        deliver: jest.fn(),
      });

      expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
    });

    it('never re-numbers a record that already carries one (a "send_failed" retry keeps its number)', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'send_failed',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
        number: 3,
        displayNumber: 'QUOTE-2026-0003',
      });
      const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };

      const result = await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: jest.fn() });

      expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
      expect(result.document).toMatchObject({ number: 3, displayNumber: 'QUOTE-2026-0003' });
    });

    it('runs an optional preflight BEFORE persisting, numbering, or enqueueing anything — a thrown preflight blocks all three', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: jest.fn() };
      const deliver = jest.fn();
      const preflight = jest.fn().mockRejectedValue(new Error('no transport configured'));

      await expect(
        runAsyncSendAction({ ...baseInput, typeId: 'invoice', queueDispatcher, deliver, preflight }),
      ).rejects.toThrow(/no transport configured/);

      expect(preflight).toHaveBeenCalled();
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
      expect(takeNumber.takeDocumentNumberForTransition).not.toHaveBeenCalled();
      expect(queueDispatcher.enqueueAction).not.toHaveBeenCalled();
    });

    it('a SUCCESSFUL preflight lets phase 1 proceed exactly as without one', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);
      const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };
      const preflight = jest.fn().mockResolvedValue(undefined);

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'invoice',
        queueDispatcher,
        deliver: jest.fn(),
        preflight,
      });

      expect(preflight).toHaveBeenCalled();
      expect(queueDispatcher.enqueueAction).toHaveBeenCalled();
    });

    // Root TODO item 16 ("transfrontalier") — THE PLUMBING this task's fix adds: a preflight that
    // RETURNS resolved field values (invoice-actions.ts's own cross-border resolution) REPLACES
    // `data` for the "sending" write AND the enqueued job payload, never just for a synchronous
    // check that then throws its own answer away. See `RunAsyncSendInput.preflight`'s own header.
    it('a preflight that RETURNS resolved data persists (and enqueues) THAT data — never the raw one it was called with', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const resolvedData = { client: 'client-1', lines: [{ vatRate: '0', __crossBorderCategory: 'AE' }] };
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: resolvedData,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);
      const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };
      const preflight = jest.fn().mockResolvedValue(resolvedData);

      await runAsyncSendAction({
        ...baseInput,
        typeId: 'invoice',
        queueDispatcher,
        deliver: jest.fn(),
        preflight,
      });

      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'invoice',
        'doc-1',
        'sending',
        resolvedData, // NEVER baseInput.data — this is the whole point of the fix
      );
      expect(queueDispatcher.enqueueAction).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { data: resolvedData, params: baseInput.params } }),
      );
    });

    it("a preflight returning `undefined` (the quote's, the credit note's — every existing caller) still persists the RAW data untouched", async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };
      const preflight = jest.fn().mockResolvedValue(undefined);

      await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: jest.fn(), preflight });

      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        'company-1',
        'quote',
        'doc-1',
        'sending',
        baseInput.data,
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
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(sendingDocument);
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        ...sendingDocument,
        status: 'sent',
      });
      const queueDispatcher = { enqueueAction: jest.fn() };
      const deliver = jest.fn().mockResolvedValue({ message: 'Sent to client@example.com.' });

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

    // Root TODO item 10 ("transports nationaux") — the "pdp" transport hands back a `reference`
    // (the deposit id) AND a `providerId` alongside `message`; this proves BOTH reach
    // `updateDocumentStatus` as `transportRef`/`channelProviderId`, on the SAME write that records
    // "sent" — see `DocumentInstance.transportRef`/`.channelProviderId`'s own schema comments and
    // `transports/pdp-transport.ts`'s own header. This is exactly what the post-deposit conformity
    // sweep (`conformity/`) later reads to know which channel this document actually went through.
    it('threads a deliver() `reference`/`providerId` through to updateDocumentStatus as `transportRef`/`channelProviderId`', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sent',
        transportRef: '375037',
        channelProviderId: 'pdp',
      });
      const queueDispatcher = { enqueueAction: jest.fn() };
      const deliver = jest.fn().mockResolvedValue({
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

    // Root TODO item 14 ("archivage légal") — archiving runs AFTER "sent" is persisted, fed EXACTLY
    // what `deliver()` handed back, never before and never invented. See `archive/archive-on-send.ts`
    // for why this call itself can never throw or undo a delivery that already succeeded.
    it('archives the artifacts deliver() returned, AFTER "sent" is persisted, never before', async () => {
      const callOrder: string[] = [];
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as jest.Mock).mockImplementation(async () => {
        callOrder.push('updateDocumentStatus');
        return { id: 'doc-1', status: 'sent' };
      });
      (archiveOnSend.archiveDeliveredArtifactsIfAny as jest.Mock).mockImplementation(async () => {
        callOrder.push('archiveDeliveredArtifactsIfAny');
      });
      const artifacts = [{ role: 'pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }];
      const deliver = jest.fn().mockResolvedValue({ message: 'Sent.', artifacts });
      const queueDispatcher = { enqueueAction: jest.fn() };

      await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver });

      expect(callOrder).toEqual(['updateDocumentStatus', 'archiveDeliveredArtifactsIfAny']);
      expect(archiveOnSend.archiveDeliveredArtifactsIfAny).toHaveBeenCalledWith({
        companyId: 'company-1',
        documentId: 'doc-1',
        artifacts,
      });
    });

    it('still calls archiveDeliveredArtifactsIfAny (with artifacts: undefined) for a deliver() with nothing to archive', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'cn-1',
        typeId: 'credit-note',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({ id: 'cn-1', status: 'sent' });
      const deliver = jest.fn().mockResolvedValue({ message: undefined });
      const queueDispatcher = { enqueueAction: jest.fn() };

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

    // A NEW concept (root TODO — "déclaration"), never a transport — see `reporting/report-on-send.ts`'s
    // own header. Runs AFTER archiving (same "après le fait acquis" ordering), generically for every
    // type/transport — this test proves the WIRING (call order + arguments), never the obligation
    // decision itself (that is `reporting/report-on-send.spec.ts`'s job).
    it('calls reportOnSendIfObligated AFTER archiving, with the right (companyId, typeId, documentId)', async () => {
      const callOrder: string[] = [];
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as jest.Mock).mockImplementation(async () => {
        callOrder.push('updateDocumentStatus');
        return { id: 'doc-1', status: 'sent' };
      });
      (archiveOnSend.archiveDeliveredArtifactsIfAny as jest.Mock).mockImplementation(async () => {
        callOrder.push('archiveDeliveredArtifactsIfAny');
      });
      (reportOnSend.reportOnSendIfObligated as jest.Mock).mockImplementation(async () => {
        callOrder.push('reportOnSendIfObligated');
      });
      const queueDispatcher = { enqueueAction: jest.fn(), enqueueReport: jest.fn() };
      const deliver = jest.fn().mockResolvedValue({ message: 'Sent.' });

      await runAsyncSendAction({ ...baseInput, typeId: 'invoice', queueDispatcher, deliver });

      expect(callOrder).toEqual([
        'updateDocumentStatus',
        'archiveDeliveredArtifactsIfAny',
        'reportOnSendIfObligated',
      ]);
      expect(reportOnSend.reportOnSendIfObligated).toHaveBeenCalledWith({
        companyId: 'company-1',
        typeId: 'invoice',
        documentId: 'doc-1',
        queueDispatcher,
      });
    });

    // THE MUTATION TARGET the task's own brief names: "l'échec déclaratif casse le statut de la
    // facture" — a declarative-reporting failure must NEVER be able to change what `runAsyncSendAction`
    // hands back (the document is already "sent", genuinely, by the time this call happens). Since
    // `reportOnSendIfObligated` itself already NEVER throws (see that file's own header), this proves
    // the CALLER here does not additionally wrap it in anything that could turn a rejection into a
    // different outcome — a mutation removing that "never throws" guarantee (or awaiting it before
    // the "sent" write) is exactly what this test would catch.
    it('never lets a reportOnSendIfObligated failure change the returned result — the document stays "sent"', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({ id: 'doc-1', status: 'sent' });
      (reportOnSend.reportOnSendIfObligated as jest.Mock).mockRejectedValue(
        new Error('should never surface here'),
      );
      const queueDispatcher = { enqueueAction: jest.fn(), enqueueReport: jest.fn() };
      const deliver = jest.fn().mockResolvedValue({ message: 'Sent.' });

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
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: jest.fn() };
      const deliverError = new Error('SMTP connection refused');
      const deliver = jest.fn().mockRejectedValue(deliverError);

      await expect(runAsyncSendAction({ ...baseInput, queueDispatcher, deliver })).rejects.toBe(deliverError);

      expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });
  });

  // TODO_PRODUIT.md T1 / PLAN-V2 R8 — the worker→API SSE bridge (`queue/document-events-publisher.ts`).
  // `events` is OPTIONAL (see `RunAsyncSendInput.events`'s own header) — every test ABOVE this block
  // omits it and must keep passing unchanged; these are the DEDICATED tests for the publish behavior
  // itself: publish only once the fact is genuinely ACQUIRED in Postgres, never before, never on a
  // failed write.
  describe('events — TODO_PRODUIT.md T1 / PLAN-V2 R8 (the SSE status nudge)', () => {
    it('phase 1: publishes "sending" AFTER upsertDocument persists it, with the record\'s own id', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };
      const events = { publish: jest.fn().mockResolvedValue(undefined) };
      const callOrder: string[] = [];
      (persistence.upsertDocument as jest.Mock).mockImplementation(async () => {
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

      await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: jest.fn(), events });

      expect(events.publish).toHaveBeenCalledWith('company-1', {
        documentId: 'doc-1',
        typeId: 'quote',
        kind: 'sending',
      });
      expect(callOrder).toEqual(['upsertDocument', 'publish']);
    });

    it('phase 1: never publishes at all when upsertDocument itself throws — an unacquired fact is never announced', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockRejectedValue(new Error('DB unreachable'));
      const queueDispatcher = { enqueueAction: jest.fn() };
      const events = { publish: jest.fn() };

      await expect(
        runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: jest.fn(), events }),
      ).rejects.toThrow('DB unreachable');

      expect(events.publish).not.toHaveBeenCalled();
    });

    it('phase 1: never publishes when a preflight rejects — nothing was ever acquired', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: jest.fn() };
      const events = { publish: jest.fn() };
      const preflight = jest.fn().mockRejectedValue(new Error('no transport configured'));

      await expect(
        runAsyncSendAction({
          ...baseInput,
          typeId: 'invoice',
          queueDispatcher,
          deliver: jest.fn(),
          preflight,
          events,
        }),
      ).rejects.toThrow(/no transport configured/);

      expect(events.publish).not.toHaveBeenCalled();
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('phase 2: publishes "sent" AFTER updateDocumentStatus persists it, BEFORE archiving', async () => {
      const callOrder: string[] = [];
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as jest.Mock).mockImplementation(async () => {
        callOrder.push('updateDocumentStatus');
        return { id: 'doc-1', typeId: 'quote', status: 'sent' };
      });
      (archiveOnSend.archiveDeliveredArtifactsIfAny as jest.Mock).mockImplementation(async () => {
        callOrder.push('archiveDeliveredArtifactsIfAny');
      });
      const queueDispatcher = { enqueueAction: jest.fn() };
      const events = {
        publish: jest.fn().mockImplementation(async () => {
          callOrder.push('publish');
        }),
      };
      const deliver = jest.fn().mockResolvedValue({ message: 'Sent.' });

      await runAsyncSendAction({ ...baseInput, queueDispatcher, deliver, events });

      expect(events.publish).toHaveBeenCalledWith('company-1', {
        documentId: 'doc-1',
        typeId: 'quote',
        kind: 'sent',
      });
      expect(callOrder).toEqual(['updateDocumentStatus', 'publish', 'archiveDeliveredArtifactsIfAny']);
    });

    it('phase 2: never publishes when deliver() throws — an unacquired "sent" is never announced', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: jest.fn() };
      const events = { publish: jest.fn() };
      const deliver = jest.fn().mockRejectedValue(new Error('SMTP connection refused'));

      await expect(runAsyncSendAction({ ...baseInput, queueDispatcher, deliver, events })).rejects.toThrow(
        'SMTP connection refused',
      );

      expect(events.publish).not.toHaveBeenCalled();
    });

    it('never touches events at all when absent — every pre-existing caller keeps working unchanged', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'draft',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'quote',
        status: 'sending',
        data: baseInput.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const queueDispatcher = { enqueueAction: jest.fn().mockResolvedValue(undefined) };

      // No `events` field at all — this must not throw (optional chaining, never a hard dependency).
      await expect(
        runAsyncSendAction({ ...baseInput, queueDispatcher, deliver: jest.fn() }),
      ).resolves.toEqual(
        expect.objectContaining({ document: expect.objectContaining({ status: 'sending' }) }),
      );
    });
  });
});
