import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ecb-historical-rates-client');
vi.mock('./nbp-rates-client');

import { resolveEcbRateAsOf } from './ecb-historical-rates-client';
import { resolveNbpRateBefore } from './nbp-rates-client';
import { resolveVatCurrencyConversion, VatCurrencyRateUnavailableError } from './resolve-vat-currency';

const mockedEcb = vi.mocked(resolveEcbRateAsOf);
const mockedNbp = vi.mocked(resolveNbpRateBefore);

describe('resolveVatCurrencyConversion: against the REAL shipped catalog (FR/PL/IT/DE/PT)', () => {
  afterEach(() => vi.resetAllMocks());

  it('returns null for a country with no shipped rule at all (permissive, never a block)', async () => {
    const result = await resolveVatCurrencyConversion('US', 'USD', '2026-09-25', {
      netMinor: 10000,
      vatMinor: 2000,
    });
    expect(result).toBeNull();
    expect(mockedEcb).not.toHaveBeenCalled();
    expect(mockedNbp).not.toHaveBeenCalled();
  });

  it('returns null when the invoice currency already IS the national one (nothing to convert)', async () => {
    const result = await resolveVatCurrencyConversion('FR', 'EUR', '2026-09-25', {
      netMinor: 10000,
      vatMinor: 2000,
    });
    expect(result).toBeNull();
    expect(mockedEcb).not.toHaveBeenCalled();
  });

  it('returns null for a country whose rule is a settled "not required" (Germany)', async () => {
    const result = await resolveVatCurrencyConversion('DE', 'USD', '2026-09-25', {
      netMinor: 10000,
      vatMinor: 2000,
    });
    expect(result).toBeNull();
    expect(mockedEcb).not.toHaveBeenCalled();
  });

  it('returns null for Portugal (unverified, treated as not-required)', async () => {
    const result = await resolveVatCurrencyConversion('PT', 'USD', '2026-09-25', {
      netMinor: 10000,
      vatMinor: 2000,
    });
    expect(result).toBeNull();
  });

  it('FRANCE: converts VAT only (not the taxable amount), from ECB, at the resolved rate', async () => {
    mockedEcb.mockResolvedValue({ rate: 0.85, asOf: '2026-09-24' });

    const result = await resolveVatCurrencyConversion('FR', 'USD', '2026-09-25', {
      netMinor: 100000,
      vatMinor: 20000,
    });

    expect(mockedEcb).toHaveBeenCalledWith('USD', '2026-09-25');
    expect(result).toEqual({
      nationalCurrency: 'EUR',
      taxableMinor: null,
      vatMinor: 17000, // 20000 * 0.85
      rate: 0.85,
      rateAsOf: '2026-09-24',
      rateSource: 'ecb',
    });
  });

  it('ITALY: converts BOTH the taxable amount and the VAT, from ECB', async () => {
    mockedEcb.mockResolvedValue({ rate: 0.9, asOf: '2026-09-25' });

    const result = await resolveVatCurrencyConversion('IT', 'USD', '2026-09-25', {
      netMinor: 100000,
      vatMinor: 22000,
    });

    expect(result).toEqual({
      nationalCurrency: 'EUR',
      taxableMinor: 90000,
      vatMinor: 19800,
      rate: 0.9,
      rateAsOf: '2026-09-25',
      rateSource: 'ecb',
    });
  });

  it('POLAND: converts VAT only, from NBP specifically, never calls the ECB client', async () => {
    mockedNbp.mockResolvedValue({ rate: 4.2, asOf: '2026-09-23' });

    const result = await resolveVatCurrencyConversion('PL', 'USD', '2026-09-25', {
      netMinor: 100000,
      vatMinor: 23000,
    });

    expect(mockedNbp).toHaveBeenCalledWith('USD', '2026-09-25');
    expect(mockedEcb).not.toHaveBeenCalled();
    expect(result).toEqual({
      nationalCurrency: 'PLN',
      taxableMinor: null,
      vatMinor: 96600, // 23000 minor USD -> major 230 -> *4.2 -> 966 major PLN -> 96600 minor
      rate: 4.2,
      rateAsOf: '2026-09-23',
      rateSource: 'nbp',
    });
  });

  it('POLAND: refuses with a named error when NBP has no rate, never silently falls back to ECB', async () => {
    mockedNbp.mockResolvedValue(undefined);

    await expect(
      resolveVatCurrencyConversion('PL', 'USD', '2026-09-25', { netMinor: 100000, vatMinor: 23000 }),
    ).rejects.toThrow(VatCurrencyRateUnavailableError);
    expect(mockedEcb).not.toHaveBeenCalled();
  });

  it('FRANCE: refuses with a named error when the ECB has no rate for this currency/date', async () => {
    mockedEcb.mockResolvedValue(undefined);

    await expect(
      resolveVatCurrencyConversion('FR', 'USD', '2026-09-25', { netMinor: 100000, vatMinor: 20000 }),
    ).rejects.toThrow(VatCurrencyRateUnavailableError);
  });

  it('propagates a genuine transport failure unwrapped, never mislabels it "no rate"', async () => {
    mockedEcb.mockRejectedValue(new Error('ECB daily rates feed responded with HTTP 503'));

    await expect(
      resolveVatCurrencyConversion('FR', 'USD', '2026-09-25', { netMinor: 100000, vatMinor: 20000 }),
    ).rejects.toThrow('ECB daily rates feed responded with HTTP 503');
  });
});

describe('resolveVatCurrencyConversion: VAT_CURRENCY_RATE_FAKE=1 (the e2e/CI gate)', () => {
  afterEach(() => {
    vi.resetAllMocks();
    delete process.env.VAT_CURRENCY_RATE_FAKE;
  });

  it('never calls the REAL ECB client, uses the deterministic fake instead', async () => {
    process.env.VAT_CURRENCY_RATE_FAKE = '1';

    const result = await resolveVatCurrencyConversion('FR', 'USD', '2026-09-25', {
      netMinor: 100000,
      vatMinor: 20000,
    });

    expect(mockedEcb).not.toHaveBeenCalled();
    expect(result).toMatchObject({ nationalCurrency: 'EUR', rate: 0.85, rateAsOf: '2026-09-25' });
  });

  it('never calls the REAL NBP client, uses the deterministic fake instead, refusal included', async () => {
    process.env.VAT_CURRENCY_RATE_FAKE = '1';

    const ok = await resolveVatCurrencyConversion('PL', 'USD', '2026-09-25', {
      netMinor: 100000,
      vatMinor: 23000,
    });
    expect(mockedNbp).not.toHaveBeenCalled();
    expect(ok).toMatchObject({ nationalCurrency: 'PLN', rate: 4.2, rateAsOf: '2026-09-24' });

    // GBP is deliberately absent from the NBP fake table, see fake-rate-clients.ts's own header:
    // this is what lets the SAME fake gate exercise the real refusal path end-to-end in Cypress.
    await expect(
      resolveVatCurrencyConversion('PL', 'GBP', '2026-09-25', { netMinor: 100000, vatMinor: 23000 }),
    ).rejects.toThrow(VatCurrencyRateUnavailableError);
    expect(mockedNbp).not.toHaveBeenCalled();
  });
});
