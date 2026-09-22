import { redactUrlCredentials } from '@/utils/redact-url';

/**
 * The password used throughout is a literal nobody could mistake for a real one, and every assertion
 * below is written as "the output does NOT contain it" rather than as an expected string: a test that
 * spelled out the whole redacted URL would pass just as happily if the function started leaking a
 * DIFFERENT secret.
 */
const SECRET = 'not-a-real-password';

describe('redactUrlCredentials', () => {
  it('drops the password out of a Redis URL', () => {
    const redacted = redactUrlCredentials(`redis://:${SECRET}@redis.internal:6379`);
    expect(redacted).not.toContain(SECRET);
  });

  it('keeps the destination — a diagnostic that will not say where it tried is not a diagnostic', () => {
    const redacted = redactUrlCredentials(`redis://:${SECRET}@redis.internal:6379/3`);
    expect(redacted).toContain('redis.internal');
    expect(redacted).toContain('6379');
    // The database index, which is what tells two environments sharing one Redis apart.
    expect(redacted).toContain('/3');
  });

  it('keeps the username — it is not the secret, and it is often the thing that is wrong', () => {
    const redacted = redactUrlCredentials(`rediss://acl-user:${SECRET}@redis.example:6380`);
    expect(redacted).toContain('acl-user');
    expect(redacted).toContain('rediss:');
    expect(redacted).not.toContain(SECRET);
  });

  it('leaves a URL with no credential in it completely alone', () => {
    expect(redactUrlCredentials('redis://localhost:6379')).toBe('redis://localhost:6379');
  });

  it('redacts a credential hiding in a query parameter', () => {
    const redacted = redactUrlCredentials(`redis://redis.internal:6379?password=${SECRET}`);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).toContain('redis.internal');
  });

  it('redacts a password containing an @ — the LAST @ separates userinfo from the host', () => {
    const awkward = `p@ss${SECRET}`;
    const redacted = redactUrlCredentials(`redis://user:${encodeURIComponent(awkward)}@redis.internal:6379`);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).toContain('redis.internal');
  });

  it('redacts input it cannot parse rather than handing it back — a typo does not declassify it', () => {
    // No port, a stray space: `new URL()` may or may not accept a given malformation across Node
    // versions, and the output must be safe either way.
    const redacted = redactUrlCredentials(`redis://user:${SECRET}@ho st`);
    expect(redacted).not.toContain(SECRET);
  });

  it('handles a Postgres URL the same way, since a connection string is a connection string', () => {
    const redacted = redactUrlCredentials(`postgresql://app:${SECRET}@db.internal:5432/invoicerr`);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).toContain('db.internal:5432');
    expect(redacted).toContain('invoicerr');
  });
});
