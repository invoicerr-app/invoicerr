import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveNbpRateBefore } from './nbp-rates-client';

function mockFetchOnce(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('resolveNbpRateBefore', () => {
  afterEach(() => vi.resetAllMocks());

  it('returns the LAST published quotation in the window, the business day preceding the target', async () => {
    mockFetchOnce({
      code: 'A',
      currency: 'dolar amerykański',
      rates: [
        { no: '184/A/NBP/2026', effectiveDate: '2026-09-22', mid: 4.01 },
        { no: '185/A/NBP/2026', effectiveDate: '2026-09-23', mid: 4.05 },
      ],
    });

    const result = await resolveNbpRateBefore('USD', '2026-09-24');

    // NBP's own "mid" is already PLN-per-unit, no inversion, unlike the ECB client.
    expect(result).toEqual({ rate: 4.05, asOf: '2026-09-23' });
  });

  it('requests the window ending the day BEFORE the target date, never including it', async () => {
    const fetchMock = mockFetchOnce({ code: 'A', currency: 'x', rates: [] });

    await resolveNbpRateBefore('USD', '2026-09-24');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/usd/2026-09-14/2026-09-23/');
  });

  it('returns undefined on a 404 (NBP has nothing for this range), never throws', async () => {
    mockFetchOnce(undefined, false, 404);

    const result = await resolveNbpRateBefore('USD', '2026-09-24');

    expect(result).toBeUndefined();
  });

  it('returns undefined on a 200 with an empty rates array', async () => {
    mockFetchOnce({ code: 'A', currency: 'x', rates: [] });

    const result = await resolveNbpRateBefore('USD', '2026-09-24');

    expect(result).toBeUndefined();
  });

  it('throws on a non-404 HTTP error, never silently "not found"', async () => {
    mockFetchOnce(undefined, false, 500);

    await expect(resolveNbpRateBefore('USD', '2026-09-24')).rejects.toThrow(/HTTP 500/);
  });

  it('throws on a non-numeric mid rather than silently converting at a bad rate', async () => {
    mockFetchOnce({
      code: 'A',
      currency: 'x',
      rates: [{ no: '1', effectiveDate: '2026-09-23', mid: Number.NaN }],
    });

    await expect(resolveNbpRateBefore('USD', '2026-09-24')).rejects.toThrow(/non-numeric/);
  });
});
