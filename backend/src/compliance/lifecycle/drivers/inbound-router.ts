/**
 * Inbound router — the durable driver for CALLBACK triggers (COMPLIANCE_LIFECYCLE.md §4). It is the
 * domain entry point for statuses *pushed* to us by an authority/buyer (SdI, a PDP, Peppol MLR, a
 * CDR). Two operations, both event-driven (no tick): `register()` records that a document is awaiting
 * callbacks (from a runtime AWAIT_CALLBACK effect), and `receive()` routes an incoming message to the
 * matching document's runtime as an INBOUND_STATUS signal — deduped and correlated.
 *
 * The transport (an HTTP webhook controller / SSE consumer / inbox poller) lives outside this pure
 * module and simply calls `receive()`; here the store / clock / applySignal are injected for testing.
 */
import { ComplianceLogger, defaultLogger } from '../../execution/logger';
import { ChannelType } from '../../types';
import { Effect, LifecycleSignal } from '../runtime';
import {
  CallbackRegistration,
  CallbackStore,
  createRegistration,
  InboundMessage,
  InMemoryCallbackStore,
} from './inbound-job';

export type AwaitCallbackEffect = Extract<Effect, { kind: 'AWAIT_CALLBACK' }>;

export type ApplySignal = (documentId: string, signal: LifecycleSignal, log: ComplianceLogger) => void | Promise<void>;

export interface InboundRouterDeps {
  applySignal: ApplySignal;
  store?: CallbackStore;
  now?: () => Date;
  idgen?: () => string;
  log?: ComplianceLogger;
}

export interface InboundInput {
  channel: ChannelType;
  correlationKey: string;
  status: string;
  rawRef?: string;
}

export type ReceiveResult =
  | { kind: 'ROUTED'; documentId: string; signal: LifecycleSignal }
  | { kind: 'DUPLICATE' }
  | { kind: 'UNMATCHED'; correlationKey: string };

let seq = 0;

export class InboundRouter {
  private readonly store: CallbackStore;
  private readonly now: () => Date;
  private readonly idgen: () => string;
  private readonly applySignal: ApplySignal;
  private readonly log: ComplianceLogger;

  constructor(deps: InboundRouterDeps) {
    this.applySignal = deps.applySignal;
    this.store = deps.store ?? new InMemoryCallbackStore();
    this.now = deps.now ?? (() => new Date());
    this.idgen = deps.idgen ?? (() => `cb_${Date.now()}_${seq++}`);
    this.log = deps.log ?? defaultLogger;
  }

  /** Register that a document awaits callbacks. `correlationKey` is the transmit/authority ref. */
  async register(documentId: string, effect: AwaitCallbackEffect, opts: { channel: ChannelType; correlationKey: string }): Promise<CallbackRegistration> {
    const reg = createRegistration(
      { id: this.idgen(), documentId, channel: opts.channel, correlationKey: opts.correlationKey, awaiting: effect.awaiting },
      this.now(),
    );
    return this.store.register(reg);
  }

  /** Cancel a document's registrations (optional cleanup; a stale callback is a safe runtime no-op). */
  async cancelForDocument(documentId: string): Promise<void> {
    await this.store.cancelForDocument(documentId);
  }

  /** An inbound status arrived: dedup → correlate → feed INBOUND_STATUS into the document's runtime. */
  async receive(input: InboundInput): Promise<ReceiveResult> {
    const msg: InboundMessage = {
      id: this.idgen(),
      channel: input.channel,
      correlationKey: input.correlationKey,
      status: input.status,
      rawRef: input.rawRef,
      receivedAt: this.now().toISOString(),
    };

    const { duplicate } = await this.store.recordMessage(msg);
    if (duplicate) {
      this.log.info('lifecycle/inbound-router', `duplicate inbound "${input.rawRef ?? msg.id}" dropped`);
      return { kind: 'DUPLICATE' };
    }

    const reg = await this.store.findByCorrelation(input.channel, input.correlationKey);
    if (!reg) {
      this.log.warn('lifecycle/inbound-router', `unmatched inbound ${input.channel}:${input.correlationKey} ("${input.status}")`);
      return { kind: 'UNMATCHED', correlationKey: input.correlationKey };
    }

    const signal: LifecycleSignal = { type: 'INBOUND_STATUS', status: input.status };
    await this.applySignal(reg.documentId, signal, this.log);
    return { kind: 'ROUTED', documentId: reg.documentId, signal };
  }
}
