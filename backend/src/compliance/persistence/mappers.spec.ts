import { ComplianceDocumentRecord } from '../operations/types';
import { documentToRecord, documentToCreateInput } from './mappers';
import { ComplianceStatus } from '../lifecycle/state-machine';
import { PollJob } from '../lifecycle/drivers/poll-job';
import { TimerJob } from '../lifecycle/drivers/timer-job';
import { CallbackRegistration, InboundMessage } from '../lifecycle/drivers/inbound-job';
import { rowToPollJob, pollJobToRow, rowToTimerJob, timerJobToRow, rowToCallbackReg, callbackRegToRow, rowToInboundMsg, inboundMsgToRow } from './mappers';

function now() {
  return new Date().toISOString();
}

const ts = () => new Date().toISOString();

describe('document mappers', () => {
  const ctx = {
    supplier: { legalName: 'FR Co', countryCode: 'FR', role: 'B2B' as const, identifiers: [{ scheme: 'VAT', value: 'FR1', validated: true }] },
    buyer: { legalName: 'IT Co', countryCode: 'IT', role: 'B2B' as const, identifiers: [{ scheme: 'VAT', value: 'IT1', validated: true }] },
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'GOODS' as const }],
    issueDate: new Date('2027-01-15T10:00:00Z'),
    currency: 'EUR',
  };

  const record: ComplianceDocumentRecord = {
    id: 'doc-1',
    kind: 'INVOICE',
    direction: 'OUTBOUND',
    status: 'ISSUED' as ComplianceStatus,
    ctx: ctx as any,
    plan: { supplier: { country: 'FR', confidence: 'OFFICIAL' }, buyer: { country: 'IT', confidence: 'OFFICIAL' }, classification: { buyerRole: 'B2B', crossBorder: true, supplyTypes: ['GOODS'] } as any, tax: { lines: [], reportingFlags: [], mentions: [], buyerSelfAssess: false }, taxSystemKind: 'VAT', regime: { model: 'POST_AUDIT', blocking: false }, artifacts: [], channels: [{ type: 'PEPPOL' }], numbering: { model: 'GAPLESS_SELF' }, lifecycle: { immutableAfter: 'ISSUE', correctionModel: 'CREDIT_NOTE', cancellation: { allowed: true, requiresAuthorityAck: false } }, archival: { retentionYears: 10, archivedForm: 'HYBRID_PDF', integrity: 'NONE' }, reporting: [], confidence: 'OFFICIAL', warnings: [] },
    number: 'INV-001',
    immutableHash: 'sha256:123',
    correctsId: undefined,
    authorityIds: [{ scheme: 'UUID', value: 'abc-123' }],
    events: [{ type: 'CREATED', at: now() }, { type: 'ISSUE', at: now() }],
    createdAt: ts(),
    updatedAt: ts(),
  };

  it('round-trips a ComplianceDocumentRecord through toRow → toRecord', () => {
    const data = documentToCreateInput(record);
    expect(data.id).toBe(record.id);
    expect(data.kind).toBe(record.kind);
    expect(data.status).toBe(record.status);
    expect(data.ctx).toEqual(record.ctx);
    expect(data.plan).toEqual(record.plan);
    expect(data.events!.create).toHaveLength(2);
    expect(data.authorityIds!.create).toHaveLength(1);

    // Simulate what Prisma returns after upsert
    const now2 = new Date();
    const fakeRow: any = {
      id: record.id,
      kind: record.kind,
      direction: record.direction,
      status: record.status,
      ctx: data.ctx,
      plan: data.plan ?? null,
      number: data.number ?? null,
      immutableHash: data.immutableHash ?? null,
      previousHash: data.previousHash ?? null,
      correctsId: data.correctsId ?? null,
      createdAt: now2,
      updatedAt: now2,
      events: [
        { id: 'e1', documentId: record.id, type: 'CREATED', at: new Date(record.events[0].at), actor: null, detail: null, payload: null },
        { id: 'e2', documentId: record.id, type: 'ISSUE', at: new Date(record.events[1].at), actor: null, detail: null, payload: null },
      ],
      authorityIds: [
        { id: 'a1', documentId: record.id, scheme: 'UUID', value: 'abc-123', issuedAt: now2 },
      ],
    };

    const roundtrip = documentToRecord(fakeRow);
    expect(roundtrip.status).toBe(record.status);
    expect(roundtrip.ctx.issueDate).toEqual(new Date('2027-01-15T10:00:00Z'));
    expect(roundtrip.ctx.supplier.legalName).toBe('FR Co');
    expect(roundtrip.number).toBe('INV-001');
    expect(roundtrip.immutableHash).toBe('sha256:123');
    expect(roundtrip.authorityIds).toEqual([{ scheme: 'UUID', value: 'abc-123' }]);
    expect(roundtrip.events).toHaveLength(2);
    expect(roundtrip.direction).toBe('OUTBOUND');
  });

  it('handles null plan and undefined optional fields', () => {
    const minimal: ComplianceDocumentRecord = {
      id: 'doc-2',
      kind: 'CREDIT_NOTE',
      direction: 'OUTBOUND',
      status: 'DRAFT' as ComplianceStatus,
      ctx: ctx as any,
      authorityIds: [],
      events: [],
      createdAt: ts(),
      updatedAt: ts(),
    };
    const data = documentToCreateInput(minimal);
    expect(data.plan).toBeNull();
    expect(data.number).toBeNull();
    expect(data.immutableHash).toBeNull();
    const fake: any = {
      id: minimal.id, kind: minimal.kind, direction: minimal.direction,
      status: minimal.status, ctx: data.ctx, plan: null, number: null,
      immutableHash: null, previousHash: null, correctsId: null,
      createdAt: new Date(), updatedAt: new Date(),
      events: [], authorityIds: [],
    };
    const back = documentToRecord(fake);
    expect(back.id).toBe('doc-2');
    expect(back.plan).toBeUndefined();
    expect(back.number).toBeUndefined();
  });
});

describe('pollJob mappers', () => {
  const job: PollJob = {
    id: 'pj-1',
    documentId: 'doc-1',
    providerId: 'pac',
    channel: 'PAC',
    ref: 'UUID-1',
    awaiting: 'PENDING_CLEARANCE',
    attempts: 0,
    createdAt: new Date('2027-01-15T00:00:00Z').toISOString(),
    nextRunAt: new Date('2027-01-15T00:00:30Z').toISOString(),
    expiresAt: new Date('2027-01-16T00:00:00Z').toISOString(),
    status: 'PENDING',
    policy: { everySeconds: 30, timeoutHours: 24, backoff: 'EXPONENTIAL' as const },
  };

  it('round-trips through rowTo/ToRow', () => {
    const row = pollJobToRow(job, 'POLL');
    expect(row.id).toBe('pj-1');
    expect(row.kind).toBe('POLL');
    const fake: any = {
      id: 'pj-1', documentId: 'doc-1', kind: 'POLL', status: 'PENDING',
      awaiting: 'PENDING_CLEARANCE', providerId: 'pac', channel: 'PAC', ref: 'UUID-1',
      attempts: 0, nextRunAt: new Date(job.nextRunAt), expiresAt: new Date(job.expiresAt),
      policy: job.policy, createdAt: new Date(job.createdAt),
      onElapse: null, fireAt: null,
    };
    const back = rowToPollJob(fake);
    expect(back.id).toBe(job.id);
    expect(back.documentId).toBe(job.documentId);
    expect(back.providerId).toBe(job.providerId);
    expect(back.awaiting).toBe(job.awaiting);
    expect(back.attempts).toBe(0);
    expect(back.status).toBe('PENDING');
    expect(back.policy).toEqual(job.policy);
  });
});

describe('timerJob mappers', () => {
  const job: TimerJob = {
    id: 'tj-1',
    documentId: 'doc-1',
    awaiting: 'AWAITING_RESPONSE',
    onElapse: 'ACCEPT',
    createdAt: new Date('2027-01-15T00:00:00Z').toISOString(),
    fireAt: new Date('2027-01-23T00:00:00Z').toISOString(),
    status: 'ARMED',
  };

  it('round-trips through rowTo/ToRow', () => {
    const row = timerJobToRow(job, 'TIMER');
    expect(row.kind).toBe('TIMER');
    expect(row.onElapse).toBe('ACCEPT');
    const fake: any = {
      id: 'tj-1', documentId: 'doc-1', kind: 'TIMER', status: 'ARMED',
      awaiting: 'AWAITING_RESPONSE', onElapse: 'ACCEPT', fireAt: new Date(job.fireAt),
      createdAt: new Date(job.createdAt),
      providerId: null, channel: null, ref: null, attempts: 0,
      nextRunAt: null, expiresAt: null, policy: null,
    };
    const back = rowToTimerJob(fake);
    expect(back.id).toBe(job.id);
    expect(back.onElapse).toBe('ACCEPT');
    expect(back.status).toBe('ARMED');
  });
});

describe('callback mappers', () => {
  it('round-trips CallbackRegistration', () => {
    const reg: CallbackRegistration = {
      id: 'cb-1', documentId: 'doc-1', channel: 'SDI' as any,
      correlationKey: 'ref-1', awaiting: 'PENDING_CLEARANCE',
      status: 'WAITING', createdAt: new Date().toISOString(),
    };
    const row = callbackRegToRow(reg);
    const fake: any = {
      id: 'cb-1', documentId: 'doc-1', channel: 'SDI',
      correlationKey: 'ref-1', awaiting: 'PENDING_CLEARANCE',
      status: 'WAITING', createdAt: new Date(reg.createdAt),
    };
    const back = rowToCallbackReg(fake);
    expect(back.id).toBe(reg.id);
    expect(back.correlationKey).toBe('ref-1');
    expect(back.status).toBe('WAITING');
  });

  it('round-trips InboundMessage', () => {
    const msg: InboundMessage = {
      id: 'im-1', channel: 'SDI' as any, correlationKey: 'ref-1',
      status: 'consegnata', rawRef: 'm1', receivedAt: new Date().toISOString(),
    };
    const row = inboundMsgToRow(msg);
    const fake: any = { ...row, receivedAt: new Date(msg.receivedAt) };
    const back = rowToInboundMsg(fake);
    expect(back.id).toBe(msg.id);
    expect(back.rawRef).toBe('m1');
    expect(back.status).toBe('consegnata');
  });

  it('round-trips InboundMessage without rawRef', () => {
    const msg: InboundMessage = {
      id: 'im-2', channel: 'SDI' as any, correlationKey: 'ref-2',
      status: 'consegnata', receivedAt: new Date().toISOString(),
    };
    const row = inboundMsgToRow(msg);
    expect(row.rawRef).toBeNull();
    const fake: any = { ...row, receivedAt: new Date(msg.receivedAt) };
    const back = rowToInboundMsg(fake);
    expect(back.rawRef).toBeUndefined();
  });
});
