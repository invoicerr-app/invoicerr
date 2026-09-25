import { BadRequestException } from '@nestjs/common';

import { DOCUMENT_LIST_MAX_PAGE_SIZE, parseListDocumentsQuery } from './list-documents.dto';

describe('parseListDocumentsQuery', () => {
  it('defaults page to 1, pageSize to 25, sort to updatedAt, order to desc — no other field set', () => {
    expect(parseListDocumentsQuery({})).toEqual({
      page: 1,
      pageSize: 25,
      status: undefined,
      clientId: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      q: undefined,
      sort: 'updatedAt',
      order: 'desc',
    });
  });

  it.each(['0', '-1', 'abc', '1.5', ''])('refuses a page of %j', (value) => {
    expect(() => parseListDocumentsQuery({ page: value })).toThrow(BadRequestException);
  });

  it.each(['0', '-1', 'abc'])('refuses a pageSize of %j', (value) => {
    expect(() => parseListDocumentsQuery({ pageSize: value })).toThrow(BadRequestException);
  });

  it(`clamps a pageSize above ${DOCUMENT_LIST_MAX_PAGE_SIZE} down to the ceiling, never a 400`, () => {
    expect(parseListDocumentsQuery({ pageSize: '500' }).pageSize).toBe(DOCUMENT_LIST_MAX_PAGE_SIZE);
  });

  it('accepts a plain positive pageSize under the ceiling as-is', () => {
    expect(parseListDocumentsQuery({ pageSize: '10' }).pageSize).toBe(10);
  });

  it('normalizes status from a repeated query key', () => {
    expect(parseListDocumentsQuery({ status: ['draft', 'sent'] }).status).toEqual(['draft', 'sent']);
  });

  it('normalizes status from one comma-separated value', () => {
    expect(parseListDocumentsQuery({ status: 'draft,sent' }).status).toEqual(['draft', 'sent']);
  });

  it('drops blank entries from a status list (trailing comma, stray whitespace)', () => {
    expect(parseListDocumentsQuery({ status: 'draft,, sent ,' }).status).toEqual(['draft', 'sent']);
  });

  it('trims clientId and q, and treats a blank one as absent', () => {
    expect(parseListDocumentsQuery({ clientId: '  client-1  ' }).clientId).toBe('client-1');
    expect(parseListDocumentsQuery({ clientId: '   ' }).clientId).toBeUndefined();
    expect(parseListDocumentsQuery({ q: ' acme ' }).q).toBe('acme');
    expect(parseListDocumentsQuery({ q: '' }).q).toBeUndefined();
  });

  it('accepts a valid YYYY-MM-DD dateFrom/dateTo', () => {
    const parsed = parseListDocumentsQuery({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    expect(parsed.dateFrom).toBe('2026-01-01');
    expect(parsed.dateTo).toBe('2026-01-31');
  });

  it.each([
    '2026/01/01',
    '01-01-2026',
    'not-a-date',
    '2026-13-01',
  ])('refuses a dateFrom that is not YYYY-MM-DD at all: %j', (value) => {
    expect(() => parseListDocumentsQuery({ dateFrom: value })).toThrow(BadRequestException);
  });

  it('refuses dateFrom after dateTo', () => {
    expect(() => parseListDocumentsQuery({ dateFrom: '2026-02-01', dateTo: '2026-01-01' })).toThrow(
      BadRequestException,
    );
  });

  it('accepts dateFrom equal to dateTo (a single-day range)', () => {
    expect(() => parseListDocumentsQuery({ dateFrom: '2026-01-15', dateTo: '2026-01-15' })).not.toThrow();
  });

  it('accepts every whitelisted sort field', () => {
    for (const sort of ['updatedAt', 'createdAt', 'number', 'status']) {
      expect(parseListDocumentsQuery({ sort }).sort).toBe(sort);
    }
  });

  it('refuses a sort field outside the whitelist (e.g. "amount" — not a real column)', () => {
    expect(() => parseListDocumentsQuery({ sort: 'amount' })).toThrow(BadRequestException);
  });

  it('accepts "asc"/"desc" for order, refuses anything else', () => {
    expect(parseListDocumentsQuery({ order: 'asc' }).order).toBe('asc');
    expect(parseListDocumentsQuery({ order: 'desc' }).order).toBe('desc');
    expect(() => parseListDocumentsQuery({ order: 'ASC' })).toThrow(BadRequestException);
  });

  it('leaves settlement absent when not passed', () => {
    expect(parseListDocumentsQuery({}).settlement).toBeUndefined();
  });

  it('accepts "unsettled"/"overdue" for settlement', () => {
    expect(parseListDocumentsQuery({ settlement: 'unsettled' }).settlement).toBe('unsettled');
    expect(parseListDocumentsQuery({ settlement: 'overdue' }).settlement).toBe('overdue');
  });

  it(
    'refuses a settlement value outside the whitelist (this parse step knows nothing about typeId; ' +
      'the "only valid with typeId=invoice" restriction lives in documents.service.ts)',
    () => {
      expect(() => parseListDocumentsQuery({ settlement: 'paid' })).toThrow(BadRequestException);
    },
  );
});
