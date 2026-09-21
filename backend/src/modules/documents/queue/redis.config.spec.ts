import { describeRedisTarget } from './redis.config';

/**
 * `describeRedisTarget()` is the one string this process writes about its Redis connection, and it
 * goes straight to stdout on every boot (`redis-required.guard.ts`'s success line) and into an
 * exception message on every failed one. The assertion that matters is that the password never
 * appears in it — written as "does not contain", never as an expected literal, so the test cannot be
 * satisfied by a line that leaks a different secret.
 */
const SECRET = 'not-a-real-password';

describe('describeRedisTarget — what the boot log is allowed to say', () => {
  const saved = {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  };

  beforeEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
  });

  afterEach(() => {
    for (const [name, value] of [
      ['REDIS_URL', saved.url],
      ['REDIS_HOST', saved.host],
      ['REDIS_PORT', saved.port],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('never puts the REDIS_URL password in the line it returns', () => {
    process.env.REDIS_URL = `redis://:${SECRET}@redis.internal:6379`;
    expect(describeRedisTarget()).not.toContain(SECRET);
  });

  it('still names the host and port — the operator has to know where it tried', () => {
    process.env.REDIS_URL = `redis://:${SECRET}@redis.internal:6379/2`;
    const target = describeRedisTarget();
    expect(target).toContain('redis.internal');
    expect(target).toContain('6379');
    expect(target).toContain('/2');
  });

  it('keeps the ACL username, which is regularly the thing that is misconfigured', () => {
    process.env.REDIS_URL = `rediss://queue-user:${SECRET}@redis.example:6380`;
    const target = describeRedisTarget();
    expect(target).toContain('queue-user');
    expect(target).not.toContain(SECRET);
  });

  it('describes the host/port branch unchanged — REDIS_PASSWORD was never part of this string', () => {
    process.env.REDIS_HOST = 'redis';
    process.env.REDIS_PORT = '6380';
    expect(describeRedisTarget()).toBe('redis:6380');
  });

  it('falls back to localhost:6379 with nothing configured at all', () => {
    expect(describeRedisTarget()).toBe('localhost:6379');
  });
});
