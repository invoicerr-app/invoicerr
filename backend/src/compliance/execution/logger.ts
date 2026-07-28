/**
 * Tiny, dependency-free logger for the compliance execution layer. Kept separate from the NestJS
 * logger so the whole `compliance/` module stays pure and unit-testable. Swap in `RecordingLogger`
 * in tests to assert which providers were called (and which still log TODO).
 */
export type ComplianceLogLevel = 'todo' | 'info' | 'warn' | 'error';

export interface ComplianceLogger {
  todo(scope: string, message: string): void;
  info(scope: string, message: string): void;
  warn(scope: string, message: string): void;
  /**
   * M-2: a genuine, unrecoverable failure surfaced on a non-blocking path (e.g.
   * `ComplianceService.recordWiringFailure`). Distinct from `warn` (an anticipated, already
   * handled condition) — `error` means "this needs a human", never a shrug.
   */
  error(scope: string, message: string): void;
}

export class ConsoleComplianceLogger implements ComplianceLogger {
  todo(scope: string, message: string): void {
    console.warn(`[compliance:TODO] ${scope}: ${message}`);
  }
  info(scope: string, message: string): void {
    console.debug(`[compliance] ${scope}: ${message}`);
  }
  warn(scope: string, message: string): void {
    console.warn(`[compliance:WARN] ${scope}: ${message}`);
  }
  error(scope: string, message: string): void {
    console.error(`[compliance:ERROR] ${scope}: ${message}`);
  }
}

export interface LogEntry {
  level: ComplianceLogLevel;
  scope: string;
  message: string;
}

/** Captures log calls instead of printing — used by tests to verify the pipeline wiring. */
export class RecordingComplianceLogger implements ComplianceLogger {
  readonly entries: LogEntry[] = [];
  todo(scope: string, message: string): void {
    this.entries.push({ level: 'todo', scope, message });
  }
  info(scope: string, message: string): void {
    this.entries.push({ level: 'info', scope, message });
  }
  warn(scope: string, message: string): void {
    this.entries.push({ level: 'warn', scope, message });
  }
  error(scope: string, message: string): void {
    this.entries.push({ level: 'error', scope, message });
  }
  scopes(): string[] {
    return this.entries.map((e) => e.scope);
  }
  hasScope(scope: string): boolean {
    return this.entries.some((e) => e.scope === scope);
  }
}

export const defaultLogger: ComplianceLogger = new ConsoleComplianceLogger();
