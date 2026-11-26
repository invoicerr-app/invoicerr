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

/** The values of a provider's `credentialEnvVars`, keyed by variable name, so each name is written once.
 *  Only called once `isConfigured` (`credentialsPresent`) has passed, hence the `string` values. */
export function readCredentials<const T extends readonly string[]>(envVars: T): Record<T[number], string> {
  const entries = envVars.map((name) => [name, process.env[name] as string]);
  return Object.fromEntries(entries) as Record<T[number], string>;
}
