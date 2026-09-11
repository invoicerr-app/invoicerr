import { fetchEcbDailyRates } from './ecb-rates-client';

/** A trimmed but structurally real fixture — the SAME three-level `<Cube>` nesting
 *  (envelope > dated cube > one per currency) the real feed uses, just with two currencies instead
 *  of the ~30 the live feed carries. */
const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender>
    <gesmes:name>European Central Bank</gesmes:name>
  </gesmes:Sender>
  <Cube>
    <Cube time="2026-09-11">
      <Cube currency="USD" rate="1.0812"/>
      <Cube currency="GBP" rate="0.8567"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

function mockFetchOnce(body: string, ok = true, status = 200): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('fetchEcbDailyRates', () => {
  afterEach(() => jest.resetAllMocks());

  it('parses the reference date and every currency/rate pair from the fixture', async () => {
    mockFetchOnce(FIXTURE_XML);

    const { referenceDate, rates } = await fetchEcbDailyRates();

    expect(referenceDate).toBe('2026-09-11');
    expect(rates.get('USD')).toBe(1.0812);
    expect(rates.get('GBP')).toBe(0.8567);
    expect(rates.size).toBe(2);
    // EUR is the implicit base — never a key of its own in the parsed map (currency-rate-sweep.ts's
    // own header explains why every caller must treat a missing EUR entry as "1", not "uncovered").
    expect(rates.has('EUR')).toBe(false);
  });

  it('throws when the HTTP response itself is not ok', async () => {
    mockFetchOnce('', false, 503);

    await expect(fetchEcbDailyRates()).rejects.toThrow(/HTTP 503/);
  });

  it('throws on malformed XML rather than returning a half-empty map', async () => {
    mockFetchOnce('<not><valid');

    await expect(fetchEcbDailyRates()).rejects.toThrow();
  });

  it('throws when the document has no dated Cube at all', async () => {
    mockFetchOnce('<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"/>');

    await expect(fetchEcbDailyRates()).rejects.toThrow(/no dated/);
  });

  it('throws when the dated Cube carries no currency rates', async () => {
    mockFetchOnce(
      '<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">' +
        '<Cube><Cube time="2026-09-11"/></Cube></gesmes:Envelope>',
    );

    await expect(fetchEcbDailyRates()).rejects.toThrow(/no currency rates/);
  });
});
