import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';

import { betterAuthLoggerOptions, logBetterAuthLine } from './better-auth-logger';

const EMAIL = 'ada.lovelace@acme.test';
const PASSWORD = 'correct-horse-battery-staple';
const WRONG_PASSWORD = 'wrong-horse-battery-staple';

/** Everything that reaches the process's output, whichever path a logger takes to get there. */
function captureOutput(): { text: () => string } {
  const chunks: string[] = [];
  const record = (...args: unknown[]) => {
    chunks.push(
      args
        .map((arg) => {
          if (typeof arg === 'string') return arg;
          if (arg instanceof Uint8Array) return Buffer.from(arg).toString('utf8');
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' '),
    );
  };
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    record(chunk);
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    record(chunk);
    return true;
  });
  return { text: () => chunks.join('\n') };
}

function createAuth(logger: Record<string, unknown>) {
  return betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'a-test-secret-that-is-long-enough-for-better-auth-0123456789',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    emailAndPassword: { enabled: true },
    // `debug` publishes every line, including the sign-up line that names the email.
    logger: { level: 'debug', ...logger },
  });
}

/** A sign-up, a duplicate sign-up, a wrong password and an unknown account. */
async function runAuthenticationFlow(auth: ReturnType<typeof createAuth>): Promise<void> {
  await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'Ada' } });
  await auth.api
    .signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: 'Ada' } })
    .catch(() => undefined);
  await auth.api.signInEmail({ body: { email: EMAIL, password: WRONG_PASSWORD } }).catch(() => undefined);
  await auth.api
    .signInEmail({ body: { email: 'nobody@acme.test', password: WRONG_PASSWORD } })
    .catch(() => undefined);
}

describe('better-auth logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('logBetterAuthLine', () => {
    it('redacts the message and every argument', () => {
      const output = captureOutput();

      logBetterAuthLine('error', `Sign-up attempt for existing email: ${EMAIL}`, {
        email: EMAIL,
        password: PASSWORD,
        nested: { token: 'abc' },
      });
      logBetterAuthLine('warn', 'Failed', new Error(`user ${EMAIL} rejected`));

      const text = output.text();
      expect(text).toContain('Sign-up attempt for existing email');
      expect(text).toContain('Failed');
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain('abc');
    });

    it('keeps the level of each line', () => {
      const output = captureOutput();

      logBetterAuthLine('error', 'an error line');
      logBetterAuthLine('warn', 'a warn line');
      logBetterAuthLine('info', 'an info line');

      const text = output.text();
      expect(text).toMatch(/ERROR[^\n]*an error line/);
      expect(text).toMatch(/WARN[^\n]*a warn line/);
      expect(text).toMatch(/LOG[^\n]*an info line/);
    });
  });

  describe('a real sign-up and sign-in', () => {
    it('leaks the email to the console with the library default logger', async () => {
      const output = captureOutput();

      await runAuthenticationFlow(createAuth({}));

      // Proves the capture sees the library's lines: without the routing below, the email gets out.
      expect(output.text()).toContain(EMAIL);
    });

    it('writes neither the email nor the password once routed through the redaction filter', async () => {
      const output = captureOutput();

      await runAuthenticationFlow(createAuth(betterAuthLoggerOptions));

      const text = output.text();
      expect(text).toContain('Better Auth');
      expect(text).toContain('Invalid password');
      expect(text).not.toContain(EMAIL);
      expect(text).not.toContain('nobody@acme.test');
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain(WRONG_PASSWORD);
    });
  });
});
