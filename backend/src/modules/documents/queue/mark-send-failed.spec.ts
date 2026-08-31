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
});
