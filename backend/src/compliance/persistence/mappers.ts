import {
  ComplianceCallbackRegistration as CallbackRegistrationRow,
  ComplianceInboundMessage as InboundMessageRow,
  Prisma,
  ScheduledJob as ScheduledJobRow,
} from '../../../prisma/generated/prisma/client';
import { TransactionContext } from '../canonical/canonical-document';
import { ComplianceDocumentEvent, ComplianceDocumentRecord } from '../operations/types';
import { PollJob } from '../lifecycle/drivers/poll-job';
import { TimerJob } from '../lifecycle/drivers/timer-job';
import { CallbackRegistration, InboundMessage } from '../lifecycle/drivers/inbound-job';
import { PollPolicy } from '../providers/transmission/transmission-provider';
import { ChannelType } from '../types';

type DocumentRow = Prisma.ComplianceDocumentGetPayload<{ include: { events: true; authorityIds: true } }>;

/**
 * Nullable Json column write. Invariant: the stores have always passed plain JS `null` (not
 * Prisma.JsonNull) for absent values — this helper keeps that runtime behavior byte-identical.
 */
function toNullableJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? null) as unknown as Prisma.InputJsonValue;
}

function rehydrateCtx(raw: Prisma.JsonValue): TransactionContext {
  // Invariant: the ctx Json column always stores a serialized TransactionContext (issueDate as ISO string).
  const ctx = raw as unknown as TransactionContext;
  return { ...ctx, issueDate: new Date(ctx.issueDate) };
}

export function documentToRecord(row: DocumentRow): ComplianceDocumentRecord {
  return {
    id: row.id,
    kind: row.kind,
    direction: row.direction,
    status: row.status as ComplianceDocumentRecord['status'],
    ctx: rehydrateCtx(row.ctx),
    plan: (row.plan ?? undefined) as ComplianceDocumentRecord['plan'],
    number: row.number ?? undefined,
    immutableHash: row.immutableHash ?? undefined,
    previousHash: row.previousHash ?? undefined,
    authorityIds: row.authorityIds.map((a) => ({ scheme: a.scheme, value: a.value })),
    correctsId: row.correctsId ?? undefined,
    invoiceId: row.invoiceId ?? undefined,
    events: row.events.map(
      (e): ComplianceDocumentEvent => ({
        id: e.id,
        type: e.type,
        at: e.at.toISOString(),
        actor: e.actor ?? undefined,
        detail: e.detail ?? undefined,
        payload: e.payload ?? undefined,
      }),
    ),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function documentToCreateInput(
  record: ComplianceDocumentRecord,
): Prisma.ComplianceDocumentCreateInput {
  return {
    id: record.id,
    kind: record.kind,
    direction: record.direction,
    status: record.status,
    // Invariant: TransactionContext is JSON-serializable (issueDate persists as an ISO string).
    ctx: record.ctx as unknown as Prisma.InputJsonValue,
    plan: toNullableJson(record.plan),
    number: record.number ?? null,
    immutableHash: record.immutableHash ?? null,
    previousHash: record.previousHash ?? null,
    correctsId: record.correctsId ?? null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    events: {
      create: record.events.map((e) => ({
        id: e.id,
        type: e.type,
        at: new Date(e.at),
        actor: e.actor ?? null,
        detail: e.detail ?? null,
        payload: toNullableJson(e.payload),
      })),
    },
    authorityIds: {
      create: record.authorityIds.map((a) => ({ scheme: a.scheme, value: a.value })),
    },
    ...(record.invoiceId ? { invoice: { connect: { id: record.invoiceId } } } : {}),
  };
}

export function documentToUpdateInput(
  record: ComplianceDocumentRecord,
): Prisma.ComplianceDocumentUpdateInput {
  return {
    id: record.id,
    kind: record.kind,
    direction: record.direction,
    status: record.status,
    // Invariant: TransactionContext is JSON-serializable (issueDate persists as an ISO string).
    ctx: record.ctx as unknown as Prisma.InputJsonValue,
    plan: toNullableJson(record.plan),
    number: record.number ?? null,
    immutableHash: record.immutableHash ?? null,
    previousHash: record.previousHash ?? null,
    correctsId: record.correctsId ?? null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    authorityIds: {
      deleteMany: {},
      create: record.authorityIds.map((a) => ({ scheme: a.scheme, value: a.value })),
    },
    ...(record.invoiceId ? { invoice: { connect: { id: record.invoiceId } } } : {}),
  };
}

export function pollJobToRow(job: PollJob, kind: 'POLL'): Prisma.ScheduledJobCreateInput {
  return {
    id: job.id,
    kind,
    status: job.status,
    awaiting: job.awaiting,
    providerId: job.providerId,
    channel: job.channel,
    ref: job.ref ?? null,
    attempts: job.attempts,
    nextRunAt: new Date(job.nextRunAt),
    expiresAt: new Date(job.expiresAt),
    // Invariant: PollPolicy is a plain JSON-serializable object.
    policy: job.policy as unknown as Prisma.InputJsonValue,
    createdAt: new Date(job.createdAt),
    document: { connect: { id: job.documentId } },
  };
}

/** Full-row save of a PollJob — same fields the store previously wrote by passing the job through. */
export function pollJobToUpdateRow(job: PollJob): Prisma.ScheduledJobUncheckedUpdateInput {
  return {
    documentId: job.documentId,
    status: job.status,
    awaiting: job.awaiting,
    providerId: job.providerId,
    channel: job.channel,
    ref: job.ref,
    attempts: job.attempts,
    nextRunAt: new Date(job.nextRunAt),
    expiresAt: new Date(job.expiresAt),
    // Invariant: PollPolicy is a plain JSON-serializable object.
    policy: job.policy as unknown as Prisma.InputJsonValue,
    createdAt: new Date(job.createdAt),
  };
}

export function rowToPollJob(row: ScheduledJobRow): PollJob {
  return {
    id: row.id,
    documentId: row.documentId,
    providerId: row.providerId!,
    channel: row.channel as ChannelType,
    ref: row.ref ?? undefined,
    awaiting: row.awaiting as PollJob['awaiting'],
    attempts: row.attempts,
    nextRunAt: row.nextRunAt!.toISOString(),
    expiresAt: row.expiresAt!.toISOString(),
    status: row.status as PollJob['status'],
    // Invariant: POLL rows always persist a PollPolicy in the policy Json column.
    policy: row.policy as unknown as PollPolicy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function timerJobToRow(job: TimerJob, kind: 'TIMER'): Prisma.ScheduledJobCreateInput {
  return {
    id: job.id,
    kind,
    status: job.status,
    awaiting: job.awaiting,
    onElapse: job.onElapse,
    fireAt: new Date(job.fireAt),
    createdAt: new Date(job.createdAt),
    document: { connect: { id: job.documentId } },
  };
}

/** Full-row save of a TimerJob — same fields the store previously wrote by passing the job through. */
export function timerJobToUpdateRow(job: TimerJob): Prisma.ScheduledJobUncheckedUpdateInput {
  return {
    documentId: job.documentId,
    status: job.status,
    awaiting: job.awaiting,
    onElapse: job.onElapse,
    fireAt: new Date(job.fireAt),
    createdAt: new Date(job.createdAt),
  };
}

export function rowToTimerJob(row: ScheduledJobRow): TimerJob {
  return {
    id: row.id,
    documentId: row.documentId,
    awaiting: row.awaiting as TimerJob['awaiting'],
    onElapse: row.onElapse as TimerJob['onElapse'],
    fireAt: row.fireAt!.toISOString(),
    status: row.status as TimerJob['status'],
    createdAt: row.createdAt.toISOString(),
  };
}

export function callbackRegToRow(
  reg: CallbackRegistration,
): Prisma.ComplianceCallbackRegistrationCreateInput {
  return {
    id: reg.id,
    channel: reg.channel,
    correlationKey: reg.correlationKey,
    awaiting: reg.awaiting,
    status: reg.status,
    createdAt: new Date(reg.createdAt),
    document: { connect: { id: reg.documentId } },
  };
}

/** Full-row save of a CallbackRegistration — same fields the store previously wrote by passing the registration through. */
export function callbackRegToUpdateRow(
  reg: CallbackRegistration,
): Prisma.ComplianceCallbackRegistrationUncheckedUpdateInput {
  return {
    documentId: reg.documentId,
    channel: reg.channel,
    correlationKey: reg.correlationKey,
    awaiting: reg.awaiting,
    status: reg.status,
    createdAt: new Date(reg.createdAt),
  };
}

export function rowToCallbackReg(row: CallbackRegistrationRow): CallbackRegistration {
  return {
    id: row.id,
    documentId: row.documentId,
    channel: row.channel as ChannelType,
    correlationKey: row.correlationKey,
    awaiting: row.awaiting as CallbackRegistration['awaiting'],
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function inboundMsgToRow(msg: InboundMessage): Prisma.ComplianceInboundMessageCreateInput {
  return {
    id: msg.id,
    channel: msg.channel,
    correlationKey: msg.correlationKey,
    status: msg.status,
    rawRef: msg.rawRef ?? null,
    receivedAt: new Date(msg.receivedAt),
  };
}

export function rowToInboundMsg(row: InboundMessageRow): InboundMessage {
  return {
    id: row.id,
    channel: row.channel as ChannelType,
    correlationKey: row.correlationKey,
    status: row.status,
    rawRef: row.rawRef ?? undefined,
    receivedAt: row.receivedAt.toISOString(),
  };
}
