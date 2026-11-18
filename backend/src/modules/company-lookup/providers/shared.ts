/**
 * Small helpers shared by the per-country providers.
 * Anything specific to one register stays in that country's file.
 */

/** Joins address fragments, dropping the empty ones. */
export function join(...parts: (string | number | undefined | null)[]): string | undefined {
  const s = parts
    .map((p) => (p === undefined || p === null ? '' : String(p).trim()))
    .filter(Boolean)
    .join(' ')
    .trim();
  return s || undefined;
}

/** Today in the register's own timezone — several APIs reject a "future" date. */
export function localDate(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Whether every credential a provider declares in `credentialEnvVars` is set (non-empty). A provider
 *  that declares none is always configured. Read on every call, so a test that sets a variable sees it. */
export function credentialsPresent(envVars: readonly string[]): boolean {
  return envVars.every((name) => !!process.env[name]);
}
