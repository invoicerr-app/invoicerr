import {
  REDACTED,
  REDACTED_EMAIL,
  REDACTED_SECRET,
  redactLogDetails,
  redactLogText,
  redactLogValue,
} from './redaction';

describe('redactLogText', () => {
  it('replaces an email address interpolated into a sentence', () => {
    expect(redactLogText('signup failed for ada@acme.test')).toBe(
      `signup failed for ${REDACTED_EMAIL}`,
    );
  });

  it('leaves a file path or a version string alone', () => {
    expect(redactLogText('/data/documents-archive/2026/invoice.pdf')).toBe(
      '/data/documents-archive/2026/invoice.pdf',
    );
  });

  it('replaces a bearer token', () => {
    expect(redactLogText('Authorization: Bearer abcdef1234567890')).toContain(REDACTED_SECRET);
  });

  it('replaces a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
    expect(redactLogText(`cookie ${jwt}`)).toBe(`cookie ${REDACTED_SECRET}`);
  });

  it('replaces a secret carried in a query string', () => {
    expect(redactLogText('/api/public/documents/x/pdf?token=abcdef123456')).toBe(
      `/api/public/documents/x/pdf?token=${REDACTED_SECRET}`,
    );
  });

  it('replaces an invitation code, which is 32 hex characters', () => {
    expect(redactLogText('invitation 0123456789ABCDEF0123456789ABCDEF used')).toBe(
      `invitation ${REDACTED_SECRET} used`,
    );
  });

  it('replaces a provider key that a driver error can carry verbatim', () => {
    expect(redactLogText('failed with sk_live_abcdef1234567890')).toBe(
      `failed with ${REDACTED_SECRET}`,
    );
    expect(redactLogText('hook whsec_abcdef1234567890 rejected')).toBe(
      `hook ${REDACTED_SECRET} rejected`,
    );
  });

  it('keeps a uuid intact: it is the id a support request needs', () => {
    const uuid = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
    expect(redactLogText(`company ${uuid}`)).toBe(`company ${uuid}`);
  });

  it('caps a very long value instead of writing a whole document into a log line', () => {
    expect(redactLogText('x'.repeat(5_000)).length).toBeLessThanOrEqual(2_001);
  });
});

describe('redactLogValue', () => {
  it('redacts sensitive values by key name, at any depth, in both camel and snake case', () => {
    expect(
      redactLogValue({
        email: 'ada@acme.test',
        user: { newEmail: 'grace@acme.test', phone: '+33123456789' },
        iban: 'FR7630006000011234567890189',
      }),
    ).toEqual({
      email: REDACTED,
      user: { newEmail: REDACTED, phone: REDACTED },
      iban: REDACTED,
    });
  });

  it('redacts any value under a payload or body key, the request-payload rule', () => {
    expect(redactLogValue({ body: { anything: 'goes' }, payload: 'x' })).toEqual({
      body: REDACTED,
      payload: REDACTED,
    });
  });

  it('keeps the context an incident actually needs', () => {
    expect(
      redactLogValue({
        userId: 'user-1',
        companyId: 'company-1',
        statusCode: 403,
        countryCode: 'FR',
        attempt: 2,
        provider: 'pdp',
      }),
    ).toEqual({
      userId: 'user-1',
      companyId: 'company-1',
      statusCode: 403,
      countryCode: 'FR',
      attempt: 2,
      provider: 'pdp',
    });
  });

  it('flattens an Error to name, message and stack, all redacted', () => {
    const error = new Error('cannot mail ada@acme.test');
    const redacted = redactLogValue(error) as Record<string, unknown>;

    expect(redacted.name).toBe('Error');
    expect(redacted.message).toBe(`cannot mail ${REDACTED_EMAIL}`);
    expect(String(redacted.stack)).toContain(REDACTED_EMAIL);
  });

  it("copies a driver error's extra fields (code, meta) through the key rule", () => {
    const error = Object.assign(new Error('unique constraint'), {
      code: 'P2002',
      meta: { target: ['email'], email: 'ada@acme.test' },
    });

    expect(redactLogValue(error)).toMatchObject({
      code: 'P2002',
      meta: { target: ['email'], email: REDACTED },
    });
  });

  it('summarises a buffer rather than writing its bytes', () => {
    expect(redactLogValue(Buffer.from('secret payload'))).toBe('[buffer 14 bytes]');
  });

  it('caps arrays and deeply nested objects', () => {
    const array = redactLogValue(Array.from({ length: 60 }, (_, i) => i)) as unknown[];
    expect(array).toHaveLength(51);
    expect(array[50]).toBe('[10 more]');

    let deep: Record<string, unknown> = { value: 'leaf' };
    for (let i = 0; i < 10; i++) deep = { nested: deep };
    expect(JSON.stringify(redactLogValue(deep))).toContain('[truncated]');
  });

  it('never mutates the value it was handed', () => {
    const details = { email: 'ada@acme.test' };
    redactLogValue(details);
    expect(details.email).toBe('ada@acme.test');
  });
});

describe('redactLogDetails', () => {
  it('returns an empty object for an absent details map', () => {
    expect(redactLogDetails(undefined)).toEqual({});
  });

  it('always returns a plain object, even for a caller that passed a string', () => {
    expect(redactLogDetails('hello ada@acme.test' as unknown as Record<string, unknown>)).toEqual({
      value: `hello ${REDACTED_EMAIL}`,
    });
  });
});
