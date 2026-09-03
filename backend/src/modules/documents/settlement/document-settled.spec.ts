import { WebhookEvent } from '../../../../prisma/generated/prisma/client';
import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentSettlement } from './compute-settlement';
import { crossedIntoSettled, emitDocumentSettled } from './document-settled';

/**
 * `crossedIntoSettled`/`emitDocumentSettled` — TODO_PRODUIT.md T3's own "T2bis différé". Pure crossing
 * logic proven with hand-built settlement fixtures (no Prisma, no real webhook dispatcher); the
 * dispatch itself proven with a bare `{ dispatch: jest.fn() }`, the same convention every other
 * `DocumentWebhookEmitter` call site's own spec already holds.
 */

function settlement(overrides: Partial<DocumentSettlement>): DocumentSettlement {
  return {
    totalGrossMinor: 12000,
    paidMinor: 0,
    creditedMinor: 0,
    outstandingMinor: 12000,
    excessMinor: 0,
    settled: false,
    ...overrides,
  };
}

const document: DocumentInstanceResult = {
  id: 'doc-1',
  typeId: 'invoice',
  status: 'sent',
  data: { currency: 'EUR' },
  createdAt: new Date('2026-08-01'),
  updatedAt: new Date('2026-08-01'),
};

describe('crossedIntoSettled', () => {
  it('not settled -> settled: a genuine crossing', () => {
    expect(crossedIntoSettled(settlement({ settled: false }), settlement({ settled: true }))).toBe(true);
  });

  it('not settled -> not settled (a partial payment): no crossing', () => {
    expect(crossedIntoSettled(settlement({ settled: false }), settlement({ settled: false }))).toBe(false);
  });

  it('already settled -> still settled (a redundant recompute, an overpayment on top): no crossing — never fires twice', () => {
    expect(crossedIntoSettled(settlement({ settled: true }), settlement({ settled: true }))).toBe(false);
  });

  it('settled -> not settled is not a real path today, but is honestly reported as "no crossing" (never a false settled)', () => {
    expect(crossedIntoSettled(settlement({ settled: true }), settlement({ settled: false }))).toBe(false);
  });
});

describe('emitDocumentSettled', () => {
  it('no emitter wired: no-op, never throws — "no capability, no effect"', async () => {
    await expect(
      emitDocumentSettled(undefined, 'company-1', 'invoice', document, settlement({ settled: true })),
    ).resolves.toBeUndefined();
  });

  it('dispatches DOCUMENT_SETTLED once, with the uniform payload contract plus the settlement fact', async () => {
    const webhooks = { dispatch: jest.fn().mockResolvedValue(undefined) };
    const after = settlement({ settled: true, paidMinor: 12000, outstandingMinor: 0 });

    await emitDocumentSettled(webhooks, 'company-1', 'invoice', document, after);

    expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
    expect(webhooks.dispatch).toHaveBeenCalledWith(
      WebhookEvent.DOCUMENT_SETTLED,
      expect.objectContaining({
        documentId: 'doc-1',
        typeId: 'invoice',
        companyId: 'company-1',
        document,
        settlement: after,
      }),
    );
  });

  it('a failing dispatch is caught, logged, and never propagated — the document is still settled', async () => {
    const webhooks = { dispatch: jest.fn().mockRejectedValue(new Error('endpoint down')) };

    await expect(
      emitDocumentSettled(webhooks, 'company-1', 'invoice', document, settlement({ settled: true })),
    ).resolves.toBeUndefined();
    expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
  });
});
