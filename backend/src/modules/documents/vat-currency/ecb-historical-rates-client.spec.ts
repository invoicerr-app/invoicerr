import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ECB_HISTORICAL_90D_URL,
  ECB_HISTORICAL_FULL_URL,
  parseEcbHistoricalRates,
  resolveEcbRateAsOf,
} from './ecb-historical-rates-client';

/** A trimmed but structurally real fixture, the SAME nesting the real historical feed uses (one
 *  dated `<Cube time="...">` per business day, several inside one document), just three days and two
 *  currencies instead of ~90 days and ~30 currencies. */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube>
    <Cube time="2026-09-25">
      <Cube currency="USD" rate="1.10"/>
      <Cube currency="PLN" rate="4.30"/>
    </Cube>
    <Cube time="2026-09-24">
      <Cube currency="USD" rate="1.09"/>
      <Cube currency="PLN" rate="4.29"/>
    </Cube>
    <Cube time="2026-09-23">
      <Cube currency="USD" rate="1.08"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

function mockFetchSequence(
  ...responses: { body: string; ok?: boolean; status?: number }[]
): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok ?? true,
      status: r.status ?? 200,
      text: () => Promise.resolve(r.body),
    });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('parseEcbHistoricalRates', () => {
  it('parses every dated cube into date -> (currency -> rate)', () => {
    const parsed = parseEcbHistoricalRates(FIXTURE_XML);
    expect(parsed.size).toBe(3);
    expect(parsed.get('2026-09-25')?.get('USD')).toBe(1.1);
    expect(parsed.get('2026-09-24')?.get('PLN')).toBe(4.29);
    expect(parsed.get('2026-09-23')?.get('USD')).toBe(1.08);
    expect(parsed.get('2026-09-23')?.has('PLN')).toBe(false);
  });

  it('throws on malformed XML', () => {
    expect(() => parseEcbHistoricalRates('<not><valid')).toThrow();
  });
});

describe('resolveEcbRateAsOf', () => {
  afterEach(() => vi.resetAllMocks());

  it('picks the exact date when the ECB published one for it, inverted to EUR-per-unit', async () => {
    mockFetchSequence({ body: FIXTURE_XML });

    const result = await resolveEcbRateAsOf('USD', '2026-09-25');

    expect(result).toEqual({ rate: 1 / 1.1, asOf: '2026-09-25' });
  });

  it('falls back to the latest PUBLISHED date on or before the target when the exact date has none (weekend/holiday)', async () => {
    mockFetchSequence({ body: FIXTURE_XML });

    // 2026-09-26 (a Saturday, say) has no cube; the last one at or before it is 2026-09-25.
    const result = await resolveEcbRateAsOf('USD', '2026-09-26');

    expect(result).toEqual({ rate: 1 / 1.1, asOf: '2026-09-25' });
  });

  it('never uses a cube dated AFTER the target date', async () => {
    mockFetchSequence({ body: FIXTURE_XML });

    const result = await resolveEcbRateAsOf('USD', '2026-09-24');

    expect(result).toEqual({ rate: 1 / 1.09, asOf: '2026-09-24' });
  });

  it('falls back to the full history feed when the 90-day one has nothing for this currency/date', async () => {
    const fetchMock = mockFetchSequence(
      { body: FIXTURE_XML }, // 90d feed - PLN has no 2026-09-23 quote
      {
        body:
          '<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">' +
          '<Cube><Cube time="2026-09-20"><Cube currency="PLN" rate="4.25"/></Cube></Cube></gesmes:Envelope>',
      },
    );

    const result = await resolveEcbRateAsOf('PLN', '2026-09-23');

    expect(result).toEqual({ rate: 1 / 4.25, asOf: '2026-09-20' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(ECB_HISTORICAL_90D_URL);
    expect(fetchMock.mock.calls[1][0]).toBe(ECB_HISTORICAL_FULL_URL);
  });

  it('returns undefined (never throws) when neither feed has this currency at all', async () => {
    mockFetchSequence(
      { body: FIXTURE_XML },
      {
        body:
          '<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">' +
          '<Cube><Cube time="2026-09-20"><Cube currency="USD" rate="1.00"/></Cube></Cube></gesmes:Envelope>',
      },
    );

    const result = await resolveEcbRateAsOf('ZZZ', '2026-09-23');

    expect(result).toBeUndefined();
  });

  it('throws on an HTTP error rather than treating it as "not found"', async () => {
    mockFetchSequence({ body: '', ok: false, status: 503 });

    await expect(resolveEcbRateAsOf('USD', '2026-09-25')).rejects.toThrow(/HTTP 503/);
  });
});
