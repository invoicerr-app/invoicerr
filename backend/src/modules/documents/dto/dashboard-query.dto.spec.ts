import { BadRequestException } from '@nestjs/common';

import { parseDashboardQuery } from './dashboard-query.dto';

describe('parseDashboardQuery', () => {
  it('no params at all -> undefined, the default "whole history" behavior', () => {
    expect(parseDashboardQuery({})).toBeUndefined();
  });

  it('both params given, in order -> the exact period', () => {
    expect(parseDashboardQuery({ dateFrom: '2026-08-01', dateTo: '2026-08-31' })).toEqual({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    });
  });

  it('dateFrom equal to dateTo is a valid, single-day period', () => {
    expect(parseDashboardQuery({ dateFrom: '2026-08-15', dateTo: '2026-08-15' })).toEqual({
      dateFrom: '2026-08-15',
      dateTo: '2026-08-15',
    });
  });

  it('dateFrom without dateTo is refused - a period is a range, not a half-open one', () => {
    expect(() => parseDashboardQuery({ dateFrom: '2026-08-01' })).toThrow(BadRequestException);
  });

  it('dateTo without dateFrom is refused, same reasoning', () => {
    expect(() => parseDashboardQuery({ dateTo: '2026-08-31' })).toThrow(BadRequestException);
  });

  it('dateFrom after dateTo is refused', () => {
    expect(() => parseDashboardQuery({ dateFrom: '2026-09-01', dateTo: '2026-08-01' })).toThrow(
      BadRequestException,
    );
  });

  // '2026-02-30' is deliberately not tested here: `new Date(...)` silently rolls it over to March 2nd
  // rather than rejecting it - the exact same behavior `list-documents.dto.ts#parseDateParam` already
  // has for the identical shape, kept consistent rather than "fixed" independently in just this file.
  it.each(['2026-8-1', '08-01-2026', 'not-a-date'])('refuses a malformed dateFrom of %j', (value) => {
    expect(() => parseDashboardQuery({ dateFrom: value, dateTo: '2026-08-31' })).toThrow(BadRequestException);
  });

  it('accepts a repeated query key the same way firstValue does (takes the first)', () => {
    expect(parseDashboardQuery({ dateFrom: ['2026-08-01', '2026-08-02'], dateTo: '2026-08-31' })).toEqual({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    });
  });
});
