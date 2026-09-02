/**
 * `DocumentsController.streamEvents` — TODO_PRODUIT.md T1 / PLAN-V2 R8's SSE endpoint, in isolation
 * from Redis entirely: `DocumentEventsBridge` is constructed WITHOUT calling `onModuleInit()` here
 * (no real Redis connection is ever made — see that method's own header), so this proves what THIS
 * controller does with whatever the bridge hands it, by driving the bridge's own in-process
 * EventEmitter fan-out directly through its private `emitter` field — reached the same way other
 * specs in this codebase reach a private field for a spy (e.g. `document-action.processor.spec.ts`'s
 * own `(processor as unknown as { logger: Logger }).logger`). The REAL Redis round trip (a genuine
 * publish reaching a genuine PSUBSCRIBE) is `queue/__tests__/document-events-bridge.redis.spec.ts`'s
 * job.
 *
 * THE MULTI-TENANT PROOF T1 requires explicitly: two companies, each with their OWN open SSE stream,
 * and an event published for one NEVER reaches the other's.
 */
import { EventEmitter } from 'node:events';

import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentEventMessage } from './queue/document-events';
import { DocumentEventsBridge } from './queue/document-events-bridge';
import { DocumentSchedulesService } from './schedules/schedules.service';
import { ShareLinksService } from './share-links/share-links.service';

function buildController(bridge: DocumentEventsBridge): DocumentsController {
  return new DocumentsController(
    {} as unknown as DocumentsService,
    {} as unknown as DocumentSchedulesService,
    {} as unknown as ShareLinksService,
    bridge,
  );
}

/** Simulates "a message just arrived from Redis" without any Redis connection at all — see this
 *  file's own header for why reaching the private `emitter` field directly is the right tool here. */
function emitOnBridge(bridge: DocumentEventsBridge, companyId: string, message: DocumentEventMessage): void {
  (bridge as unknown as { emitter: EventEmitter }).emitter.emit(companyId, message);
}

describe('DocumentsController.streamEvents', () => {
  let bridge: DocumentEventsBridge;

  beforeEach(() => {
    bridge = new DocumentEventsBridge(); // no onModuleInit() — no Redis connection, ever, in this file
  });

  it('relays a message published for the SAME company, wrapped as { data: message }', () => {
    const controller = buildController(bridge);
    const received: unknown[] = [];
    const subscription = controller.streamEvents('company-a').subscribe((event) => received.push(event));

    const message: DocumentEventMessage = { documentId: 'doc-1', typeId: 'invoice', kind: 'sent' };
    emitOnBridge(bridge, 'company-a', message);

    // Deliberately toEqual, not toMatchObject: `RunAsyncSendInput.events`'s own header explains why
    // this payload must stay THIN — proving it carries exactly {data: message} and nothing more is
    // part of proving "a nudge, never a second source of truth".
    expect(received).toEqual([{ data: message }]);

    subscription.unsubscribe();
  });

  it('relays every message published for that company, in order, across several nudges', () => {
    const controller = buildController(bridge);
    const received: unknown[] = [];
    const subscription = controller.streamEvents('company-a').subscribe((event) => received.push(event));

    const messages: DocumentEventMessage[] = [
      { documentId: 'doc-1', typeId: 'invoice', kind: 'sending' },
      { documentId: 'doc-1', typeId: 'invoice', kind: 'sent' },
      { documentId: 'doc-2', typeId: 'quote', kind: 'send_failed' },
    ];
    for (const message of messages) emitOnBridge(bridge, 'company-a', message);

    expect(received).toEqual(messages.map((message) => ({ data: message })));

    subscription.unsubscribe();
  });

  // THE MULTI-TENANT PROOF (TODO_PRODUIT.md T1 / PLAN-V2 R8's own acceptance criterion #3): two
  // companies, each holding their own open stream off the SAME bridge instance (exactly the
  // production shape — one dedicated Redis subscriber connection shared by every tenant's own SSE
  // connection, see `document-events-bridge.ts`'s own header) — an event for company A must reach
  // ONLY company A's stream, never company B's.
  it("NEVER relays another company's own event — two streams open on the SAME bridge, one publish, one receiver", () => {
    const controller = buildController(bridge);
    const receivedByA: unknown[] = [];
    const receivedByB: unknown[] = [];
    const subA = controller.streamEvents('company-a').subscribe((event) => receivedByA.push(event));
    const subB = controller.streamEvents('company-b').subscribe((event) => receivedByB.push(event));

    const message: DocumentEventMessage = { documentId: 'doc-1', typeId: 'invoice', kind: 'sent' };
    emitOnBridge(bridge, 'company-a', message);

    expect(receivedByA).toEqual([{ data: message }]);
    expect(receivedByB).toEqual([]);

    subA.unsubscribe();
    subB.unsubscribe();
  });

  it('the symmetric case: an event for company B never reaches company A', () => {
    const controller = buildController(bridge);
    const receivedByA: unknown[] = [];
    const receivedByB: unknown[] = [];
    const subA = controller.streamEvents('company-a').subscribe((event) => receivedByA.push(event));
    const subB = controller.streamEvents('company-b').subscribe((event) => receivedByB.push(event));

    const message: DocumentEventMessage = { documentId: 'doc-9', typeId: 'invoice', kind: 'send_failed' };
    emitOnBridge(bridge, 'company-b', message);

    expect(receivedByB).toEqual([{ data: message }]);
    expect(receivedByA).toEqual([]);

    subA.unsubscribe();
    subB.unsubscribe();
  });

  it("unsubscribing tears down THIS connection's own listener — a later publish for that company reaches no one", () => {
    const controller = buildController(bridge);
    const received: unknown[] = [];
    const subscription = controller.streamEvents('company-a').subscribe((event) => received.push(event));
    subscription.unsubscribe();

    emitOnBridge(bridge, 'company-a', { documentId: 'doc-1', typeId: 'invoice', kind: 'sent' });

    expect(received).toEqual([]);
  });
});
