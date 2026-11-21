/**
 * The application logger installed in `create-app.ts` / `worker.ts` via `app.useLogger()`.
 *
 * Nest's own `ConsoleLogger` writes to stdout and — critically — is what prints the stack trace of
 * any exception no controller/filter handled. Those traces are the "error traces" side of the log
 * surface, and their message is whatever the code threw, which can embed an email address, a token,
 * or a raw provider payload. Delegating to a `ConsoleLogger` after redacting every argument keeps the
 * normal formatting (timestamps, context, colour) while applying the same filter the `Log` table
 * gets, so both sinks agree.
 *
 * This is also why the redaction is installed HERE rather than only in `logger.service.ts`: code that
 * uses `new Logger(context)` directly (guards, boot services, framework exceptions) never touches
 * `LoggerService` at all, and would otherwise print unfiltered.
 */
import { ConsoleLogger, type LoggerService, type LogLevel } from '@nestjs/common';

import { redactLogText, redactLogValue } from './redaction';

/** Nest passes `message: unknown`, `stack?: unknown`, `context?: string` — redact each position. */
function redactMessage(message: unknown): unknown {
  if (message instanceof Error) return redactLogValue(message);
  if (typeof message === 'string') return redactLogText(message);
  return redactLogValue(message);
}

export class RedactingConsoleLogger implements LoggerService {
  private readonly delegate: ConsoleLogger;

  /** The delegate is a parameter so a spec can capture what would reach stdout. */
  constructor(delegate: ConsoleLogger = new ConsoleLogger()) {
    this.delegate = delegate;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.delegate.log(redactMessage(message), ...optionalParams.map(redactMessage));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.delegate.error(redactMessage(message), ...optionalParams.map(redactMessage));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.delegate.warn(redactMessage(message), ...optionalParams.map(redactMessage));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.delegate.debug(redactMessage(message), ...optionalParams.map(redactMessage));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.delegate.verbose(redactMessage(message), ...optionalParams.map(redactMessage));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.delegate.fatal(redactMessage(message), ...optionalParams.map(redactMessage));
  }

  setLogLevels(levels: LogLevel[]): void {
    this.delegate.setLogLevels(levels);
  }
}
