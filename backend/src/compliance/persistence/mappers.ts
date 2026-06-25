import { Prisma } from '../../../prisma/generated/prisma/client';
import { TransactionContext } from '../canonical/canonical-document';
import { ComplianceDocumentEvent, ComplianceDocumentRecord } from '../operations/types';
import { PollJob } from '../lifecycle/drivers/poll-job';
import { TimerJob } from '../lifecycle/drivers/timer-job';
import { CallbackRegistration, InboundMessage } from '../lifecycle/drivers/inbound-job';

type DocumentRow = Prisma.ComplianceDocumentGetPayload<{ include: { events: true; authorityIds: true } }>;

function rehydrateCtx(raw: any): TransactionContext {
  return { ...raw, issueDate: new Date(raw.issueDate) };
}

export function documentToRecord(row: DocumentRow): ComplianceDocumentRecord {
  return {
    id: row.id,
    kind: row.kind as ComplianceDocumentRecord['kind'],
    direction: row.direction as ComplianceDocumentRecord['direction'],
    status: row.status as ComplianceDocumentRecord['status'],
    ctx: rehydrateCtx(row.ctx as any),
    plan: (row.plan ?? undefined) as ComplianceDocumentRecord['plan'],
    number: row.number ?? undefined,
    immutableHash: row.immutableHash ?? undefined,
    previousHash: row.previousHash ?? undefined,
    authorityIds: row.authorityIds.map((a) => ({ scheme: a.scheme, value: a.value })),
    correctsId: row.correctsId ?? undefined,
    events: row.events.map((e): ComplianceDocumentEvent => ({
      id: e.id,
      type: e.type,
      at: e.at.toISOString(),
      actor: e.actor ?? undefined,
      detail: e.detail ?? undefined,
      payload: e.payload ?? undefined,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function documentToCreateInput(record: ComplianceDocumentRecord): Prisma.ComplianceDocumentCreateInput {
  return {
    id: record.id,
    kind: record.kind,
    direction: record.direction,
    status: record.status,
    ctx: record.ctx as any,
    plan: record.plan as any ?? null,
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
        payload: (e.payload as any) ?? null,
      })),
    },
    authorityIds: {
      create: record.authorityIds.map((a) => ({ scheme: a.scheme, value: a.value })),
    },
  };
}

export function documentToUpdateInput(record: ComplianceDocumentRecord): Prisma.ComplianceDocumentUpdateInput {
  return {
    id: record.id,
    kind: record.kind,
    direction: record.direction,
    status: record.status,
    ctx: record.ctx as any,
    plan: record.plan as any ?? null,
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
  };
}

export function pollJobToRow(job: PollJob, kind: 'POLL'): Prisma.ScheduledJobCreateInput {
  return {
    id: job.id,
    kind,
    status: job.status as any,
    awaiting: job.awaiting,
    providerId: job.providerId,
    channel: job.channel,
    ref: job.ref ?? null,
    attempts: job.attempts,
    nextRunAt: new Date(job.nextRunAt),
    expiresAt: new Date(job.expiresAt),
    policy: job.policy as any,
    createdAt: new Date(job.createdAt),
    document: { connect: { id: job.documentId } },
  };
}

export function rowToPollJob(row: { id: string; documentId: string; kind: string; status: string; awaiting: string; providerId: string | null; channel: string | null; ref: string | null; attempts: number; nextRunAt: Date | null; expiresAt: Date | null; policy: any; createdAt: Date }): PollJob {
  return {
    id: row.id,
    documentId: row.documentId,
    providerId: row.providerId!,
    channel: row.channel as any,
    ref: row.ref ?? undefined,
    awaiting: row.awaiting as PollJob['awaiting'],
    attempts: row.attempts,
    nextRunAt: row.nextRunAt!.toISOString(),
    expiresAt: row.expiresAt!.toISOString(),
    status: row.status as PollJob['status'],
    policy: row.policy as any,
    createdAt: row.createdAt.toISOString(),
  };
}

export function timerJobToRow(job: TimerJob, kind: 'TIMER'): Prisma.ScheduledJobCreateInput {
  return {
    id: job.id,
    kind,
    status: job.status as any,
    awaiting: job.awaiting,
    onElapse: job.onElapse,
    fireAt: new Date(job.fireAt),
    createdAt: new Date(job.createdAt),
    document: { connect: { id: job.documentId } },
  };
}

export function rowToTimerJob(row: { id: string; documentId: string; kind: string; status: string; awaiting: string; onElapse: string | null; fireAt: Date | null; createdAt: Date }): TimerJob {
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

export function callbackRegToRow(reg: CallbackRegistration): Prisma.ComplianceCallbackRegistrationCreateInput {
  return {
    id: reg.id,
    channel: reg.channel,
    correlationKey: reg.correlationKey,
    awaiting: reg.awaiting,
    status: reg.status as any,
    createdAt: new Date(reg.createdAt),
    document: { connect: { id: reg.documentId } },
  };
}

export function rowToCallbackReg(row: { id: string; documentId: string; channel: string; correlationKey: string; awaiting: string; status: string; createdAt: Date }): CallbackRegistration {
  return {
    id: row.id,
    documentId: row.documentId,
    channel: row.channel as any,
    correlationKey: row.correlationKey,
    awaiting: row.awaiting as CallbackRegistration['awaiting'],
    status: row.status as CallbackRegistration['status'],
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

export function rowToInboundMsg(row: { id: string; channel: string; correlationKey: string; status: string; rawRef: string | null; receivedAt: Date }): InboundMessage {
  return {
    id: row.id,
    channel: row.channel as any,
    correlationKey: row.correlationKey,
    status: row.status,
    rawRef: row.rawRef ?? undefined,
    receivedAt: row.receivedAt.toISOString(),
  };
}
