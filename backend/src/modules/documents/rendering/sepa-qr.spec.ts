import { buildEpcPayload, renderSepaQrDataUri } from './sepa-qr';

describe('buildEpcPayload', () => {
  it('produces the exact expected 11-line EPC069-12 v002 payload for a happy EUR case', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: 10000, // 100.00 EUR
      currency: 'EUR',
      remittance: 'INV-2026-0001',
    });

    const expected = [
      'BCD',
      '002',
      '1',
      'SCT',
      '',
      'Acme Corp',
      'FR1420041010050500013M02606',
      'EUR100.00',
      '',
      '',
      'INV-2026-0001',
    ].join('\n');

    expect(payload).toEqual(expected);

    const lines = (payload as string).split('\n');
    expect(lines[0]).toEqual('BCD');
    expect(lines[1]).toEqual('002');
    expect(lines[7]).toEqual('EUR100.00');
  });

  it('formats an amount with exactly two decimals even when the minor units are not a round hundred', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: 1234, // 12.34 EUR
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).not.toBeNull();
    expect((payload as string).split('\n')[7]).toEqual('EUR12.34');
  });

  it('strips spaces from the IBAN', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR14 2004 1010 0505 0001 3M02 606',
      amountMinor: 10000,
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).not.toBeNull();
    expect((payload as string).split('\n')[6]).toEqual('FR1420041010050500013M02606');
  });

  it('truncates the beneficiary name at 70 characters', () => {
    const longName = 'A'.repeat(100);
    const payload = buildEpcPayload({
      beneficiaryName: longName,
      iban: 'FR1420041010050500013M02606',
      amountMinor: 10000,
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).not.toBeNull();
    const nameLine = (payload as string).split('\n')[5];
    expect(nameLine).toHaveLength(70);
    expect(nameLine).toEqual('A'.repeat(70));
  });

  it('truncates the unstructured remittance at 140 characters', () => {
    const longRemittance = 'B'.repeat(200);
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: 10000,
      currency: 'EUR',
      remittance: longRemittance,
    });

    expect(payload).not.toBeNull();
    const remittanceLine = (payload as string).split('\n')[10];
    expect(remittanceLine).toHaveLength(140);
    expect(remittanceLine).toEqual('B'.repeat(140));
  });

  it('leaves the unstructured remittance empty when none is given', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: 10000,
      currency: 'EUR',
      remittance: undefined,
    });

    expect(payload).not.toBeNull();
    expect((payload as string).split('\n')[10]).toEqual('');
  });

  it('returns null for a non-EUR currency', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: 10000,
      currency: 'USD',
      remittance: null,
    });

    expect(payload).toBeNull();
  });

  it('returns null when the IBAN is missing', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: undefined,
      amountMinor: 10000,
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).toBeNull();
  });

  it('returns null when the IBAN is null', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: null,
      amountMinor: 10000,
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).toBeNull();
  });

  it('returns null when the IBAN is blank (only whitespace)', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: '   ',
      amountMinor: 10000,
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).toBeNull();
  });

  it('returns null for a zero amount', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: 0,
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).toBeNull();
  });

  it('returns null for a negative amount', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: -500,
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).toBeNull();
  });

  it('returns null when the amount exceeds 999999999.99', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: 100000000000, // 1,000,000,000.00 EUR
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).toBeNull();
  });

  it('accepts an amount right at the minimum bound (0.01 EUR)', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: 1,
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).not.toBeNull();
    expect((payload as string).split('\n')[7]).toEqual('EUR0.01');
  });

  it('accepts an amount right at the maximum bound (999999999.99 EUR)', () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: 99999999999,
      currency: 'EUR',
      remittance: null,
    });

    expect(payload).not.toBeNull();
    expect((payload as string).split('\n')[7]).toEqual('EUR999999999.99');
  });
});

describe('renderSepaQrDataUri', () => {
  it('returns a base64 PNG data URI for a valid payload', async () => {
    const payload = buildEpcPayload({
      beneficiaryName: 'Acme Corp',
      iban: 'FR1420041010050500013M02606',
      amountMinor: 10000,
      currency: 'EUR',
      remittance: 'INV-2026-0001',
    }) as string;

    const dataUri = await renderSepaQrDataUri(payload);

    expect(dataUri.startsWith('data:image/png;base64,')).toBe(true);
    expect(dataUri.length).toBeGreaterThan('data:image/png;base64,'.length);
  });
});
