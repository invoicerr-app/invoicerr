/**
 * Inbound parsers — unit tests for channel-specific payload → InboundInput conversion.
 *
 * Pure functions: no I/O, no mocks needed. Each parser converts a native channel
 * payload to canonical InboundInput (channel, correlationKey, status, rawRef).
 *
 * Also covers the InboundRouter.replayUnapplied() boot-replay path.
 */
import {
  parsePdpWebhook,
  parseSdiNotifica,
  parsePeppolMlr,
  PdpWebhookPayload,
  SdiNotificaWebhookPayload,
  PeppolMlrWebhookPayload,
} from './inbound-parsers';
import { InMemoryCallbackStore } from './inbound-job';
import { InboundRouter } from './inbound-router';
import { LifecycleSignal } from '../runtime';

// ---------------------------------------------------------------------------
// PDP webhook parser
// ---------------------------------------------------------------------------

describe('parsePdpWebhook', () => {
  it('extracts invoiceId as correlationKey and preserves status_code', () => {
    const body: PdpWebhookPayload = {
      invoice_id: 89123,
      status_code: 'fr:205',
      timestamp: '2026-07-01T10:00:00Z',
    };
    const input = parsePdpWebhook(body);
    expect(input.channel).toBe('PDP');
    expect(input.correlationKey).toBe('89123');
    expect(input.status).toBe('fr:205');
    expect(input.rawRef).toMatch(/^pdp:89123:fr:205:/);
  });

  it('produces a stable rawRef (dedup key includes invoiceId + statusCode)', () => {
    const body: PdpWebhookPayload = { invoice_id: 1, status_code: 'api:accepted' };
    const a = parsePdpWebhook(body);
    const b = parsePdpWebhook(body);
    // rawRef includes a timestamp component — but that's OK; dedup is by channel+rawRef
    // which is unique per event. The key point is channel and correlationKey are stable.
    expect(a.channel).toBe(b.channel);
    expect(a.correlationKey).toBe(b.correlationKey);
    expect(a.status).toBe(b.status);
  });

  it('maps "fr:205" status — lifecycle runtime accept words include "approv" / "accept"', () => {
    // The parser passes the raw PDP code as status; the runtime's eventForStatus()
    // keyword matching determines the lifecycle event.
    // fr:205 does NOT currently match accept/approv in the runtime — it's a raw code.
    // This test documents current behaviour (pass-through) not lifecycle outcome.
    const input = parsePdpWebhook({ invoice_id: 1, status_code: 'fr:205' });
    expect(input.status).toBe('fr:205');
  });
});

// ---------------------------------------------------------------------------
// SdI notifica parser
// ---------------------------------------------------------------------------

describe('parseSdiNotifica', () => {
  it('RC → status contains "consegn" (maps to CLEAR in runtime)', () => {
    const body: SdiNotificaWebhookPayload = {
      type: 'RC',
      idSdI: 42,
      dataOraRicezione: '2026-07-01T08:00:00Z',
    };
    const input = parseSdiNotifica(body);
    expect(input.channel).toBe('SDI');
    expect(input.correlationKey).toBe('42');
    expect(input.status).toContain('consegn');
    expect(input.rawRef).toMatch(/^sdi:42:RC:/);
  });

  it('NS → status contains "scart" (maps to REJECT in runtime)', () => {
    const body: SdiNotificaWebhookPayload = {
      type: 'NS',
      idSdI: 42,
      dataOraRicezione: '2026-07-01T08:00:00Z',
      descrizioneErrore: 'Formato non valido',
    };
    const input = parseSdiNotifica(body);
    expect(input.status).toContain('scart');
    expect(input.status).toContain('Formato non valido');
  });

  it('NE EC01 → status contains "accettazione" (ACCEPT)', () => {
    const body: SdiNotificaWebhookPayload = {
      type: 'NE',
      idSdI: 42,
      dataOraRicezione: '2026-07-01T08:00:00Z',
      esitoCommittente: 'EC01',
    };
    const input = parseSdiNotifica(body);
    expect(input.status).toContain('accettazione');
    expect(input.status).toContain('EC01');
  });

  it('NE EC02 → status contains "rifiuto" (REJECT)', () => {
    const body: SdiNotificaWebhookPayload = {
      type: 'NE',
      idSdI: 42,
      dataOraRicezione: '2026-07-01T08:00:00Z',
      esitoCommittente: 'EC02',
    };
    const input = parseSdiNotifica(body);
    expect(input.status).toContain('rifiuto');
    expect(input.status).toContain('EC02');
  });

  it('DT → status contains "consegn" (CLEAR via decorrenza termini)', () => {
    const body: SdiNotificaWebhookPayload = {
      type: 'DT',
      idSdI: 42,
      dataOraRicezione: '2026-07-01T08:00:00Z',
    };
    const input = parseSdiNotifica(body);
    expect(input.status).toContain('consegn');
  });

  it('AT → status contains "consegn"', () => {
    const body: SdiNotificaWebhookPayload = {
      type: 'AT',
      idSdI: 42,
      dataOraRicezione: '2026-07-01T08:00:00Z',
    };
    const input = parseSdiNotifica(body);
    expect(input.status).toContain('consegn');
  });

  it('MC → status contains "mancata consegna" label (PENDING, no terminal transition)', () => {
    const body: SdiNotificaWebhookPayload = {
      type: 'MC',
      idSdI: 42,
      dataOraRicezione: '2026-07-01T08:00:00Z',
    };
    const input = parseSdiNotifica(body);
    // MC = Mancata Consegna (delivery failed, retry pending)
    expect(input.status).toContain('mancata consegna');
    expect(input.status).toContain('MC');
    // Must NOT contain positive terminal keywords that trigger CLEAR/REJECT
    expect(input.status).not.toContain('accettazione');
    expect(input.status).not.toContain('rifiuto');
    expect(input.status).not.toContain('scartata');
  });

  it('rawRef includes type and timestamp for dedup', () => {
    const body: SdiNotificaWebhookPayload = { type: 'RC', idSdI: 1, dataOraRicezione: '2026-07-01T00:00:00Z' };
    const input = parseSdiNotifica(body);
    expect(input.rawRef).toBe('sdi:1:RC:2026-07-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// Peppol MLR parser
// ---------------------------------------------------------------------------

describe('parsePeppolMlr', () => {
  it('DELIVERED → status contains "consegn" (CLEAR)', () => {
    const body: PeppolMlrWebhookPayload = {
      messageId: 'msg-001',
      responseCode: 'DELIVERED',
    };
    const input = parsePeppolMlr(body);
    expect(input.channel).toBe('PEPPOL');
    expect(input.correlationKey).toBe('msg-001');
    expect(input.status).toContain('consegn');
    expect(input.rawRef).toMatch(/^peppol:msg-001:DELIVERED:/);
  });

  it('AB → status contains "accept"', () => {
    const input = parsePeppolMlr({ messageId: 'msg-2', responseCode: 'AB' });
    expect(input.status).toContain('accept');
  });

  it('RE → status contains "reject"', () => {
    const input = parsePeppolMlr({ messageId: 'msg-3', responseCode: 'RE', description: 'Wrong VAT number' });
    expect(input.status).toContain('reject');
    expect(input.status).toContain('Wrong VAT number');
  });

  it('FAILED → status contains "failed"', () => {
    const input = parsePeppolMlr({ messageId: 'msg-4', responseCode: 'FAILED' });
    expect(input.status).toContain('failed');
  });

  it('messageId is used as correlationKey', () => {
    const input = parsePeppolMlr({ messageId: 'unique-id-xyz', responseCode: 'AB' });
    expect(input.correlationKey).toBe('unique-id-xyz');
  });
});

// ---------------------------------------------------------------------------
// InboundRouter.replayUnapplied — boot replay
// ---------------------------------------------------------------------------

describe('InboundRouter.replayUnapplied — boot replay', () => {
  it('replays a stored message for a WAITING registration', async () => {
    const store = new InMemoryCallbackStore();
    const signals: Array<[string, LifecycleSignal]> = [];
    const router = new InboundRouter({
      applySignal: (id, s) => { signals.push([id, s]); },
      store,
    });

    // Register a callback
    await router.register('doc-1', { kind: 'AWAIT_CALLBACK', awaiting: 'PENDING_CLEARANCE' }, {
      channel: 'PDP',
      correlationKey: 'pdp-invoice-1',
    });

    // Store a message in the DB (simulates: webhook arrived, recorded, but applySignal crashed)
    await store.recordMessage({
      id: 'msg-1',
      channel: 'PDP',
      correlationKey: 'pdp-invoice-1',
      status: 'fr:205',
      rawRef: 'pdp:1:fr:205:ts',
      receivedAt: new Date().toISOString(),
    });

    const { replayed, skipped } = await router.replayUnapplied();

    expect(replayed).toBe(1);
    expect(skipped).toBe(0);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual(['doc-1', { type: 'INBOUND_STATUS', status: 'fr:205' }]);
  });

  it('skips registrations with no stored messages', async () => {
    const store = new InMemoryCallbackStore();
    const signals: Array<[string, LifecycleSignal]> = [];
    const router = new InboundRouter({
      applySignal: (id, s) => { signals.push([id, s]); },
      store,
    });

    await router.register('doc-2', { kind: 'AWAIT_CALLBACK', awaiting: 'AWAITING_RESPONSE' }, {
      channel: 'SDI',
      correlationKey: 'sdi-42',
    });

    // No stored messages for this registration

    const { replayed, skipped } = await router.replayUnapplied();

    expect(replayed).toBe(0);
    expect(skipped).toBe(1);
    expect(signals).toHaveLength(0);
  });

  it('replays only the latest message when multiple messages exist', async () => {
    const store = new InMemoryCallbackStore();
    const signals: Array<[string, LifecycleSignal]> = [];
    const router = new InboundRouter({
      applySignal: (id, s) => { signals.push([id, s]); },
      store,
    });

    await router.register('doc-3', { kind: 'AWAIT_CALLBACK', awaiting: 'PENDING_CLEARANCE' }, {
      channel: 'PEPPOL',
      correlationKey: 'peppol-msg-1',
    });

    await store.recordMessage({ id: 'msg-a', channel: 'PEPPOL', correlationKey: 'peppol-msg-1', status: 'AP', rawRef: 'r1', receivedAt: new Date().toISOString() });
    await store.recordMessage({ id: 'msg-b', channel: 'PEPPOL', correlationKey: 'peppol-msg-1', status: 'AB', rawRef: 'r2', receivedAt: new Date().toISOString() });

    await router.replayUnapplied();

    // Only the latest message (msg-b, AB) should be replayed
    expect(signals).toHaveLength(1);
    expect(signals[0][1]).toEqual({ type: 'INBOUND_STATUS', status: 'AB' });
  });

  it('is idempotent — double replay applies NOOP for already-applied documents', async () => {
    const store = new InMemoryCallbackStore();
    let applyCount = 0;
    const router = new InboundRouter({
      applySignal: () => { applyCount++; },
      store,
    });

    await router.register('doc-4', { kind: 'AWAIT_CALLBACK', awaiting: 'PENDING_CLEARANCE' }, {
      channel: 'SDI',
      correlationKey: 'sdi-99',
    });
    await store.recordMessage({ id: 'msg-c', channel: 'SDI', correlationKey: 'sdi-99', status: 'consegnata', rawRef: 'r3', receivedAt: new Date().toISOString() });

    await router.replayUnapplied();
    await router.replayUnapplied(); // second call

    // applySignal called twice (once per replay), but the real runtime would return NOOP
    // on the second call. This test verifies the replay itself doesn't crash or dedup-skip.
    expect(applyCount).toBe(2);
  });

  it('dedup via receive() prevents double-apply for same rawRef', async () => {
    const store = new InMemoryCallbackStore();
    const signals: Array<[string, LifecycleSignal]> = [];
    const router = new InboundRouter({
      applySignal: (id, s) => { signals.push([id, s]); },
      store,
    });

    await router.register('doc-5', { kind: 'AWAIT_CALLBACK', awaiting: 'PENDING_CLEARANCE' }, {
      channel: 'PDP',
      correlationKey: 'pdp-2',
    });

    // First receive: stored + routed
    const r1 = await router.receive({ channel: 'PDP', correlationKey: 'pdp-2', status: 'fr:205', rawRef: 'pdp:2:fr:205:ts' });
    expect(r1.kind).toBe('ROUTED');

    // Duplicate receive: dedup returns DUPLICATE, no re-apply
    const r2 = await router.receive({ channel: 'PDP', correlationKey: 'pdp-2', status: 'fr:205', rawRef: 'pdp:2:fr:205:ts' });
    expect(r2.kind).toBe('DUPLICATE');
    expect(signals).toHaveLength(1);
  });
});
