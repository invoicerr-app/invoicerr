import { ConsoleLogger } from '@nestjs/common';

import { RedactingConsoleLogger } from './redacting-console-logger';
import { REDACTED, REDACTED_EMAIL, REDACTED_SECRET } from './redaction';

function recordingLogger() {
  const calls: { level: string; args: unknown[] }[] = [];
  const logger = {
    log: (...args: unknown[]) => calls.push({ level: 'log', args }),
    error: (...args: unknown[]) => calls.push({ level: 'error', args }),
    warn: (...args: unknown[]) => calls.push({ level: 'warn', args }),
    debug: (...args: unknown[]) => calls.push({ level: 'debug', args }),
    verbose: (...args: unknown[]) => calls.push({ level: 'verbose', args }),
    fatal: (...args: unknown[]) => calls.push({ level: 'fatal', args }),
    setLogLevels: () => undefined,
  } as unknown as ConsoleLogger;
  return { logger, calls };
}

describe('RedactingConsoleLogger', () => {
  it('redacts an unhandled exception trace before it reaches the console', () => {
    const { logger, calls } = recordingLogger();
    const redacting = new RedactingConsoleLogger(logger);
    const error = new Error('Prisma failed for ada@acme.test');

    redacting.error(error, 'ExceptionsHandler');

    const [message, context] = calls[0].args as [Record<string, unknown>, string];
    expect(message.message).toBe(`Prisma failed for ${REDACTED_EMAIL}`);
    expect(String(message.stack)).toContain(REDACTED_EMAIL);
    expect(context).toBe('ExceptionsHandler');
  });

  it('redacts a string message on every level', () => {
    const { logger, calls } = recordingLogger();
    const redacting = new RedactingConsoleLogger(logger);

    redacting.log('user ada@acme.test signed in');
    redacting.warn('invitation 0123456789ABCDEF0123456789ABCDEF refused');
    redacting.debug('token=abcdef123456');
    redacting.verbose('boot');
    redacting.fatal('fatal');

    expect(calls[0].args[0]).toBe(`user ${REDACTED_EMAIL} signed in`);
    expect(calls[1].args[0]).toBe(`invitation ${REDACTED_SECRET} refused`);
    expect(calls[2].args[0]).toBe(`token=${REDACTED_SECRET}`);
  });

  it('redacts an object parameter passed alongside the message', () => {
    const { logger, calls } = recordingLogger();
    const redacting = new RedactingConsoleLogger(logger);

    redacting.error('signup failed', { email: 'ada@acme.test' });

    expect(calls[0].args[1]).toEqual({ email: REDACTED });
  });

  it('forwards setLogLevels to the delegate', () => {
    const delegate = { setLogLevels: vi.fn() } as unknown as ConsoleLogger;
    new RedactingConsoleLogger(delegate).setLogLevels(['error']);

    expect(delegate.setLogLevels).toHaveBeenCalledWith(['error']);
  });
});
