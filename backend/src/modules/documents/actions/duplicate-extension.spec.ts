import { ActionExtensionRegistry } from './action-extensions';
import { ActionRegistry } from './action-registry';
import { applyDateRecalc, registerDuplicateExtension } from './duplicate-extension';
import * as persistence from '../persistence';

jest.mock('../persistence');

describe('applyDateRecalc', () => {
  it('overrides the anchor field and shifts every dependent field by the SAME delta the source had', () => {
    const source = {
      issueDate: '2026-01-15T00:00:00.000Z',
      dueDate: '2026-01-30T00:00:00.000Z', // 15 days after issueDate on the source
      client: 'client-1',
    };

    const result = applyDateRecalc(source, '2026-02-15T00:00:00.000Z', {
      anchorField: 'issueDate',
      dependentFields: ['dueDate'],
    });

    expect(result.issueDate).toBe('2026-02-15T00:00:00.000Z');
    // 15 days after 15 Feb 2026 is 2 Mar 2026 — the delta survives a month-length change, exactly
    // the reason this is millisecond arithmetic and never "add 15 to the day-of-month".
    expect(result.dueDate).toBe('2026-03-02T00:00:00.000Z');
    expect(result.client).toBe('client-1'); // untouched fields pass through verbatim
  });

  it('never mutates the source object', () => {
    const source = { issueDate: '2026-01-15T00:00:00.000Z', dueDate: '2026-01-30T00:00:00.000Z' };
    const frozen = { ...source };
    applyDateRecalc(source, '2026-02-15T00:00:00.000Z', {
      anchorField: 'issueDate',
      dependentFields: ['dueDate'],
    });
    expect(source).toEqual(frozen);
  });

  it('leaves a dependent field alone when the source never set it (e.g. an optional dueDate)', () => {
    const source = { issueDate: '2026-01-15T00:00:00.000Z' };
    const result = applyDateRecalc(source, '2026-02-15T00:00:00.000Z', {
      anchorField: 'issueDate',
      dependentFields: ['dueDate'],
    });
    expect(result.issueDate).toBe('2026-02-15T00:00:00.000Z');
    expect(result.dueDate).toBeUndefined();
  });

  it('degrades to a verbatim copy when the source has no usable anchor date at all', () => {
    const source = { issueDate: 'not-a-date', dueDate: '2026-01-30T00:00:00.000Z' };
    const result = applyDateRecalc(source, '2026-02-15T00:00:00.000Z', {
      anchorField: 'issueDate',
      dependentFields: ['dueDate'],
    });
    expect(result).toEqual(source);
  });

  it('only overrides the anchor field when dependentFields is absent', () => {
    const source = { issueDate: '2026-01-15T00:00:00.000Z', notes: 'kept' };
    const result = applyDateRecalc(source, '2026-02-15T00:00:00.000Z', { anchorField: 'issueDate' });
    expect(result).toEqual({ issueDate: '2026-02-15T00:00:00.000Z', notes: 'kept' });
  });
});

describe('registerDuplicateExtension — the handler', () => {
  const SOURCE = {
    id: 'doc-1',
    typeId: 'invoice',
    status: 'draft',
    data: { issueDate: '2026-01-15T00:00:00.000Z', dueDate: '2026-01-30T00:00:00.000Z', client: 'c1' },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  afterEach(() => jest.resetAllMocks());

  it('with no occurrenceDate/thenSend params at all, clones the source data VERBATIM (the plain manual button)', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(SOURCE);
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({ ...SOURCE, id: 'doc-2' });

    const extensions = new ActionExtensionRegistry();
    const actions = new ActionRegistry();
    registerDuplicateExtension('invoice', extensions, actions, {
      dateRecalc: { anchorField: 'issueDate', dependentFields: ['dueDate'] },
    });

    const handler = actions.resolve('invoice', 'duplicate')!;
    await handler({ companyId: 'company-1', typeId: 'invoice', documentId: 'doc-1', data: {}, params: {} });

    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      undefined,
      'draft',
      SOURCE.data,
    );
  });

  it('with an occurrenceDate param and a registered dateRecalc, recomputes the anchor + dependent fields', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(SOURCE);
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({ ...SOURCE, id: 'doc-2' });

    const extensions = new ActionExtensionRegistry();
    const actions = new ActionRegistry();
    registerDuplicateExtension('invoice', extensions, actions, {
      dateRecalc: { anchorField: 'issueDate', dependentFields: ['dueDate'] },
    });

    const handler = actions.resolve('invoice', 'duplicate')!;
    await handler({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: {},
      params: { occurrenceDate: '2026-02-15T00:00:00.000Z' },
    });

    expect(persistence.upsertDocument).toHaveBeenCalledWith('company-1', 'invoice', undefined, 'draft', {
      issueDate: '2026-02-15T00:00:00.000Z',
      dueDate: '2026-03-02T00:00:00.000Z',
      client: 'c1',
    });
  });

  it('an occurrenceDate param is a no-op when the type was registered with NO dateRecalc (the quote today)', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(SOURCE);
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({ ...SOURCE, id: 'doc-2' });

    const extensions = new ActionExtensionRegistry();
    const actions = new ActionRegistry();
    registerDuplicateExtension('quote', extensions, actions);

    const handler = actions.resolve('quote', 'duplicate')!;
    await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'doc-1',
      data: {},
      params: { occurrenceDate: '2026-02-15T00:00:00.000Z' },
    });

    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'quote',
      undefined,
      'draft',
      SOURCE.data,
    );
  });

  // "thenSend" is NOT interpreted here at all — see this file's own header ("Why 'then send' does
  // NOT live here") for the real bug that shipped when it was: chaining "send" from INSIDE this
  // handler, when this handler is itself already running inside a queue job (a scheduled
  // occurrence), collides with "send"'s own two-phase re-enqueue and wedges the new document at
  // "sending" forever. The chaining now lives in schedule-sweep-runner.ts's `runOccurrence`
  // instead, called SYNCHRONOUSLY, outside any job context — see that file's own tests.
  it('an unknown param (e.g. thenSend) is silently ignored — this handler only ever produces a fresh draft', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(SOURCE);
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({ ...SOURCE, id: 'doc-2' });

    const extensions = new ActionExtensionRegistry();
    const actions = new ActionRegistry();
    registerDuplicateExtension('invoice', extensions, actions, {
      dateRecalc: { anchorField: 'issueDate', dependentFields: ['dueDate'] },
    });

    const handler = actions.resolve('invoice', 'duplicate')!;
    const result = await handler({
      companyId: 'company-1',
      typeId: 'invoice',
      documentId: 'doc-1',
      data: {},
      params: { thenSend: true },
    });

    expect(result.changed).toBe(true);
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      undefined,
      'draft',
      SOURCE.data,
    );
  });
});
