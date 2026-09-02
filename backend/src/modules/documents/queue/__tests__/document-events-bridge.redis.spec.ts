/**
 * The REAL Redis proof for TODO_PRODUIT.md T1 / PLAN-V2 R8's worker→API bridge: a genuine
 * `DocumentEventsPublisher.publish` (real ioredis PUBLISH) is what `DocumentEventsBridge.
 * subscribeCompany` (real ioredis PSUBSCRIBE, `document-events-bridge.ts`'s own dedicated
 * subscriber connection) actually receives — proven against real Redis rather than a mocked
 * EventEmitter, because the whole point of this mechanism (see both classes' own headers) is that it
 * survives `WORKER_INLINE=false`, where publisher and subscriber are literally different PROCESSES;
 * an in-process mock could never catch a bug in the wire format or the channel-naming scheme both
 * sides have to agree on independently.
 *
 * Gated EXACTLY like this directory's sibling Redis integration specs (`document-action-queue.redis.
 * spec.ts` et al.) — see that file's own header for why `DOCUMENTS_QUEUE_REDIS_TESTS=1` is required
 * explicitly, not merely `REDIS_URL` being set, and why the CI `queue-integration` job runs this
 * whole directory `--runInBand`.
 */
import { DocumentEventMessage } from '../document-events';
import { DocumentEventsBridge } from '../document-events-bridge';
import { DocumentEventsPublisher } from '../document-events-publisher';

const hasRedis = !!process.env.REDIS_URL && process.env.DOCUMENTS_QUEUE_REDIS_TESTS === '1';
const describeWithRedis = hasRedis ? describe : describe.skip;

/** Polls `condition` until it's true or `timeoutMs` elapses — pub/sub delivery is asynchronous over
 *  a real network round trip, so a bare synchronous assertion right after `publish()` would be racy
 *  by construction. Mirrors the "poll, don't sleep a fixed guess" discipline this codebase's own
 *  Cypress specs hold for the identical reason (see e.g. `28-document-async-send.cy.ts`). */
async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitUntil: condition never became true within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describeWithRedis('DocumentEventsPublisher / DocumentEventsBridge — real Redis pub/sub', () => {
  let publisher: DocumentEventsPublisher;
  let bridge: DocumentEventsBridge;

  beforeEach(async () => {
    publisher = new DocumentEventsPublisher();
    bridge = new DocumentEventsBridge();
    // `onModuleInit` awaits `psubscribe` internally — by the time this resolves, the subscription is
    // genuinely established with Redis, so a `publish()` right after is never racing PSUBSCRIBE itself.
    await bridge.onModuleInit();
  });

  afterEach(async () => {
    await bridge.onModuleDestroy();
    await publisher.onModuleDestroy();
  });

  it('subscribe receives exactly what publish sends, for the subscribed company', async () => {
    const companyId = `company-events-test-${Date.now()}-a`;
    const received: DocumentEventMessage[] = [];
    const unsubscribe = bridge.subscribeCompany(companyId, (message) => received.push(message));

    const sent: DocumentEventMessage = { documentId: 'doc-1', typeId: 'invoice', kind: 'sent' };
    await publisher.publish(companyId, sent);

    await waitUntil(() => received.length > 0);
    expect(received).toEqual([sent]);

    unsubscribe();
  });

  it('delivers every kind this mechanism publishes (sending/sent/send_failed/authority-event), in order', async () => {
    const companyId = `company-events-test-${Date.now()}-kinds`;
    const received: DocumentEventMessage[] = [];
    const unsubscribe = bridge.subscribeCompany(companyId, (message) => received.push(message));

    const messages: DocumentEventMessage[] = [
      { documentId: 'doc-1', typeId: 'invoice', kind: 'sending' },
      { documentId: 'doc-1', typeId: 'invoice', kind: 'sent' },
      { documentId: 'doc-2', typeId: 'invoice', kind: 'send_failed' },
      { documentId: 'doc-3', typeId: 'invoice', kind: 'authority-event' },
    ];
    for (const message of messages) {
      await publisher.publish(companyId, message);
    }

    await waitUntil(() => received.length >= messages.length);
    expect(received).toEqual(messages);

    unsubscribe();
  });

  // THE MULTI-TENANT PROOF TODO_PRODUIT.md T1 requires explicitly: two companies, the event of one
  // NEVER reaches the other — against REAL Redis, not merely asserted from the in-process
  // `EventEmitter`'s own semantics (see `document-events-bridge.ts`'s own header for why the event
  // name being the exact companyId makes cross-tenant delivery structurally impossible, proven here
  // rather than only argued).
  it("a company never receives another company's own event, even sharing the ONE dedicated subscriber connection", async () => {
    const suffix = Date.now();
    const companyA = `company-events-test-${suffix}-a`;
    const companyB = `company-events-test-${suffix}-b`;
    const receivedByA: DocumentEventMessage[] = [];
    const receivedByB: DocumentEventMessage[] = [];
    const unsubscribeA = bridge.subscribeCompany(companyA, (message) => receivedByA.push(message));
    const unsubscribeB = bridge.subscribeCompany(companyB, (message) => receivedByB.push(message));

    const messageForA: DocumentEventMessage = { documentId: 'doc-a', typeId: 'invoice', kind: 'sent' };
    await publisher.publish(companyA, messageForA);

    await waitUntil(() => receivedByA.length > 0);
    // Redis pub/sub delivery within the SAME process is effectively immediate once PUBLISH resolves —
    // this extra tick is only to give a wrongly-routed message a real chance to arrive before
    // asserting its absence, never a substitute for the `waitUntil` above.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(receivedByA).toEqual([messageForA]);
    expect(receivedByB).toEqual([]);

    unsubscribeA();
    unsubscribeB();
  });
});
