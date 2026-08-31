/**
 * Tiny, dependency-free logger for the signing providers — reprised verbatim from the repère's
 * `compliance/execution/logger.ts` (renamed: this module is not the "compliance engine", there is no
 * such thing anymore — see TODO.md's own header). Kept separate from the NestJS `logger` singleton
 * (`@/logger/logger.service`) so `providers.ts`/`registry.ts`/`tsa-client.ts` stay pure and
 * unit-testable without booting Nest — the same reasoning the repère's own header gave, still true
 * here. `RecordingSigningLogger` is what `providers.spec.ts`/`signing-registry.spec.ts` assert
 * against instead of parsing stdout.
 */
export type SigningLogLevel = 'info' | 'warn' | 'error';

export interface SigningLogger {
  info(scope: string, message: string): void;
  warn(scope: string, message: string): void;
  /** A genuine, unrecoverable failure — distinct from `warn` (an anticipated, already-handled
   *  condition, e.g. "no cert configured"). `error` means "this needs a human". */
  error(scope: string, message: string): void;
}

export class ConsoleSigningLogger implements SigningLogger {
  info(scope: string, message: string): void {
    console.debug(`[signing] ${scope}: ${message}`);
  }
  warn(scope: string, message: string): void {
    console.warn(`[signing:WARN] ${scope}: ${message}`);
  }
  error(scope: string, message: string): void {
    console.error(`[signing:ERROR] ${scope}: ${message}`);
  }
}

export interface SigningLogEntry {
  level: SigningLogLevel;
  scope: string;
  message: string;
}

/** Captures log calls instead of printing — used by tests to verify the pipeline wiring. */
export class RecordingSigningLogger implements SigningLogger {
  readonly entries: SigningLogEntry[] = [];
  info(scope: string, message: string): void {
    this.entries.push({ level: 'info', scope, message });
  }
  warn(scope: string, message: string): void {
    this.entries.push({ level: 'warn', scope, message });
  }
  error(scope: string, message: string): void {
    this.entries.push({ level: 'error', scope, message });
  }
}

export const defaultSigningLogger: SigningLogger = new ConsoleSigningLogger();
