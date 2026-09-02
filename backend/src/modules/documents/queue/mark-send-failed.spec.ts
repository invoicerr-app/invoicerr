import { NotFoundException } from '@nestjs/common';

import { transitionsAvailableWhen } from '../descriptors/lifecycle';
import { DocumentActionTransition, DocumentTypeDescriptor } from '../descriptors/types';
import * as persistence from '../persistence';
import { markSendFailed } from './mark-send-failed';

jest.mock('../persistence');

const SEND_TRANSITIONS: DocumentActionTransition[] = [
  { from: ['draft', 'send_failed'], to: 'sending' },
  { from: ['sending'], to: ['sent', 'send_failed'] },
];

function widgetDescriptor(): DocumentTypeDescriptor {
  return {
    id: 'widget',
    label: 'Widget',
    fields: [],
    statuses: [
      { id: 'draft', label: 'Draft' },
      { id: 'sending', label: 'Sending' },
      { id: 'sent', label: 'Sent' },
      { id: 'send_failed', label: 'Send failed' },
    ],
    initialStatus: 'draft',
    actions: [
      {
        id: 'send',
        label: 'Send',
        transitions: SEND_TRANSITIONS,
        availableWhen: transitionsAvailableWhen(SEND_TRANSITIONS),
      },
    ],
  };
}

/**
 * THE MUTATION TARGET #2 lives one layer up in production (a job's `deliver()`/processor persisting
 * "sent" despite failure) — but the guarantee THIS file exists to hold is that whichever error
 * reaches here, the WRITE it produces is "send_failed", checked against the type's own declared
 * lifecycle via `checkTransitionResult` — the exact same enforcement `documents.service.ts`'s
 * `runAction` applies to every synchronous handler.
 */
describe('markSendFailed', () => {
  afterEach(() => jest.resetAllMocks());

  const resolveDescriptor = () => widgetDescriptor();

  it('marks a "sending" record "send_failed", recording the error message', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'sending',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'send_failed',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await markSendFailed(resolveDescriptor, {
      companyId: 'company-1',
      typeId: 'widget',
      documentId: 'doc-1',
      actionId: 'send',
      error: new Error('SMTP connection refused'),
    });

    expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
      'company-1',
      'widget',
      'doc-1',
      'send_failed',
      'SMTP connection refused',
    );
  });

  it('is idempotent: a record that already moved past "sending" (e.g. a genuine success won the race) is left alone', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'sent',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await markSendFailed(resolveDescriptor, {
      companyId: 'company-1',
      typeId: 'widget',
      documentId: 'doc-1',
      actionId: 'send',
      error: new Error('too late'),
    });

    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });

  it('throws (a loud, named bug) if the write it just made somehow lands outside the declared lifecycle', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'sending',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // A broken persistence layer that wrote something else entirely — checkTransitionResult must
    // still catch it, the exact same discipline documents.service.ts's runAction already holds.
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      typeId: 'widget',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      markSendFailed(resolveDescriptor, {
        companyId: 'company-1',
        typeId: 'widget',
        documentId: 'doc-1',
        actionId: 'send',
        error: new Error('whatever'),
      }),
    ).rejects.toThrow(/declared lifecycle requires one of/);
  });

  it('logs and returns, rather than throwing, if the document was deleted entirely (the twin case to "already moved on")', async () => {
    // The real bug this guards: a document deleted while its terminal-failure job was still in
    // flight (a resetAndSeed racing BullMQ's still-running backoff in e2e, or any production
    // deletion of a document with a send in flight) must not escape as a throw — this handler runs
    // from `onFailed`, a BullMQ event handler where an escaped exception becomes an unhandled
    // rejection that kills the entire process (it did, twice, 2026-08-31).
    (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(
      new NotFoundException('Document "doc-1" not found for type "widget".'),
    );

    await expect(
      markSendFailed(resolveDescriptor, {
        companyId: 'company-1',
        typeId: 'widget',
        documentId: 'doc-1',
        actionId: 'send',
        error: new Error('too late, the document is gone'),
      }),
    ).resolves.toBeUndefined();

    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });

  it('logs and returns, rather than throwing, if the action id it was handed is not declared at all', async () => {
    await expect(
      markSendFailed(resolveDescriptor, {
        companyId: 'company-1',
        typeId: 'widget',
        documentId: 'doc-1',
        actionId: 'not-a-real-action',
        error: new Error('whatever'),
      }),
    ).resolves.toBeUndefined();

    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });

  // TODO_PRODUIT.md T1 / PLAN-V2 R8 — the worker→API SSE bridge. `events` is OPTIONAL (see
  // `MarkSendFailedInput.events`'s own header) — every test ABOVE this block omits it and must keep
  // passing unchanged; these are the DEDICATED tests for the publish behavior: publish only once
  // "send_failed" is genuinely ACQUIRED (write done, lifecycle check passed), never before, never for
  // any of the early-return "nothing to mark" branches.
  describe('events — TODO_PRODUIT.md T1 / PLAN-V2 R8 (the SSE status nudge)', () => {
    it('publishes "send_failed" AFTER the write and the lifecycle check both succeed', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'widget',
        status: 'sending',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'widget',
        status: 'send_failed',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const events = { publish: jest.fn().mockResolvedValue(undefined) };

      await markSendFailed(resolveDescriptor, {
        companyId: 'company-1',
        typeId: 'widget',
        documentId: 'doc-1',
        actionId: 'send',
        error: new Error('SMTP connection refused'),
        events,
      });

      expect(events.publish).toHaveBeenCalledTimes(1);
      expect(events.publish).toHaveBeenCalledWith('company-1', {
        documentId: 'doc-1',
        typeId: 'widget',
        kind: 'send_failed',
      });
    });

    it('never publishes for the idempotent "already moved on" branch — nothing was acquired here', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'widget',
        status: 'sent',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const events = { publish: jest.fn() };

      await markSendFailed(resolveDescriptor, {
        companyId: 'company-1',
        typeId: 'widget',
        documentId: 'doc-1',
        actionId: 'send',
        error: new Error('too late'),
        events,
      });

      expect(events.publish).not.toHaveBeenCalled();
    });

    it('never publishes when the write lands outside the declared lifecycle (the loud-bug branch throws first)', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'widget',
        status: 'sending',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'widget',
        status: 'draft',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const events = { publish: jest.fn() };

      await expect(
        markSendFailed(resolveDescriptor, {
          companyId: 'company-1',
          typeId: 'widget',
          documentId: 'doc-1',
          actionId: 'send',
          error: new Error('whatever'),
          events,
        }),
      ).rejects.toThrow(/declared lifecycle requires one of/);

      expect(events.publish).not.toHaveBeenCalled();
    });

    it('never publishes when the document no longer exists', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(
        new NotFoundException('Document "doc-1" not found for type "widget".'),
      );
      const events = { publish: jest.fn() };

      await markSendFailed(resolveDescriptor, {
        companyId: 'company-1',
        typeId: 'widget',
        documentId: 'doc-1',
        actionId: 'send',
        error: new Error('too late, the document is gone'),
        events,
      });

      expect(events.publish).not.toHaveBeenCalled();
    });

    it('never touches events at all when absent — every pre-existing caller keeps working unchanged', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'widget',
        status: 'sending',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'widget',
        status: 'send_failed',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // No `events` field at all — this must not throw (optional chaining, never a hard dependency).
      await expect(
        markSendFailed(resolveDescriptor, {
          companyId: 'company-1',
          typeId: 'widget',
          documentId: 'doc-1',
          actionId: 'send',
          error: new Error('SMTP connection refused'),
        }),
      ).resolves.toBeUndefined();
    });
  });
});
