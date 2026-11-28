import { Logger } from '@nestjs/common';

import { redactLogText, redactLogValue } from '../logger/redaction';

type BetterAuthLogLevel = 'debug' | 'info' | 'warn' | 'error';

const nestLogger = new Logger('Better Auth');

function formatArgument(value: unknown): string {
  const redacted = redactLogValue(value);
  if (typeof redacted === 'string') return redacted;
  try {
    return JSON.stringify(redacted);
  } catch {
    return '[unserializable]';
  }
}

/**
 * The authentication library prints straight to the console by default, so its lines (a sign-up
 * attempt for an existing email, a failed sign-in, an internal error) would skip the redaction every
 * other sink applies. Routing it here sends them through the same filter and the application logger.
 */
export function logBetterAuthLine(level: BetterAuthLogLevel, message: string, ...args: unknown[]): void {
  const text = [redactLogText(String(message)), ...args.map(formatArgument)].join(' ');
  switch (level) {
    case 'error':
      nestLogger.error(text);
      return;
    case 'warn':
      nestLogger.warn(text);
      return;
    case 'debug':
      nestLogger.debug(text);
      return;
    default:
      nestLogger.log(text);
  }
}

export const betterAuthLoggerOptions = { log: logBetterAuthLine };
