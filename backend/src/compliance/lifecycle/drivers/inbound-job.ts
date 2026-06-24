/**
 * Inbound callbacks — the durable side of the CALLBACK trigger (COMPLIANCE_LIFECYCLE.md §4). Unlike
 * poll (we ask) and timer (we wait), a callback is *pushed to us*: SdI notifiche, a PDP pushing
 * déposée/refusée/encaissée, Peppol Invoice Response/MLR, a PE CDR. When the runtime enters a state
 * whose outgoing transition is CALLBACK-driven it registers a correlation; an inbound message that
 * matches it is routed into the document's runtime as an INBOUND_STATUS signal.
 *
 * Pure core: the registration + message shapes, the store port (in-memory now, Prisma later) with
 * idempotent message recording (authorities deliver at-least-once). No I/O / no transport here.
 */
import { ChannelType } from '../../types';
import { ComplianceStatus } from '../state-machine';

export type CallbackRegistrationStatus = 'WAITING' | 'RESOLVED' | 'CANCELLED';

/** "We expect inbound messages for document D on channel C, matched by correlationKey." */
export interface CallbackRegistration {
  id: string;
  documentId: string;
  channel: ChannelType;
  correlationKey: string; // transmission ref / authority id / message thread id
  awaiting: ComplianceStatus;
  status: CallbackRegistrationStatus;
  createdAt: string;
}

/** A raw status pushed by an authority/buyer. Persisted for audit + dedup. */
export interface InboundMessage {
  id: string;
  channel: ChannelType;
  correlationKey: string;
  status: string; // raw status text (consegnata / approuvée / rechazo …)
  rawRef?: string; // provider message id, used for dedup
  receivedAt: string;
}

export interface NewRegistration {
  id: string;
  documentId: string;
  channel: ChannelType;
  correlationKey: string;
  awaiting: ComplianceStatus;
}

export function createRegistration(input: NewRegistration, now: Date): CallbackRegistration {
  return { ...input, status: 'WAITING', createdAt: now.toISOString() };
}

/** Dedup key for an inbound message (per channel, by provider ref when present). */
export function messageKey(msg: InboundMessage): string {
  return `${msg.channel}:${msg.rawRef ?? msg.id}`;
}

export interface CallbackStore {
  register(reg: CallbackRegistration): CallbackRegistration;
  save(reg: CallbackRegistration): CallbackRegistration;
  /** The WAITING registration for this channel+key, if any. */
  findByCorrelation(channel: ChannelType, correlationKey: string): CallbackRegistration | null;
  forDocument(documentId: string): CallbackRegistration[];
  cancelForDocument(documentId: string): void;
  /** Record an inbound message (audit). Returns whether it was already seen (at-least-once delivery). */
  recordMessage(msg: InboundMessage): { duplicate: boolean };
}

export class InMemoryCallbackStore implements CallbackStore {
  private readonly regs = new Map<string, CallbackRegistration>();
  private readonly messages = new Map<string, InboundMessage>();
  private readonly seen = new Set<string>();

  register(reg: CallbackRegistration): CallbackRegistration {
    this.regs.set(reg.id, reg);
    return reg;
  }
  save(reg: CallbackRegistration): CallbackRegistration {
    this.regs.set(reg.id, reg);
    return reg;
  }
  findByCorrelation(channel: ChannelType, correlationKey: string): CallbackRegistration | null {
    for (const r of this.regs.values()) {
      if (r.status === 'WAITING' && r.channel === channel && r.correlationKey === correlationKey) return r;
    }
    return null;
  }
  forDocument(documentId: string): CallbackRegistration[] {
    return [...this.regs.values()].filter((r) => r.documentId === documentId);
  }
  cancelForDocument(documentId: string): void {
    for (const r of this.regs.values()) {
      if (r.documentId === documentId && r.status === 'WAITING') {
        this.regs.set(r.id, { ...r, status: 'CANCELLED' });
      }
    }
  }
  recordMessage(msg: InboundMessage): { duplicate: boolean } {
    const key = messageKey(msg);
    if (this.seen.has(key)) return { duplicate: true };
    this.seen.add(key);
    this.messages.set(msg.id, msg);
    return { duplicate: false };
  }
}
