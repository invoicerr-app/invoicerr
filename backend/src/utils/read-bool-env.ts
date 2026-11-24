/**
 * Reads an on/off switch from the environment: "true" or "1", case-insensitively, with surrounding
 * whitespace tolerated so a stray trailing space from a copy-paste never silently reads as "unset".
 * Anything else, unset included, is off. Every boolean operator flag (`DEMO_MODE`, `DISABLE_AUTH`,
 * `OIDC_ONLY`, …) goes through this one rule, so an operator never has to remember two spellings.
 *
 * Pure and synchronous, env passed as a parameter, like the flag readers that call it.
 */
export function isEnvFlagOn(env: NodeJS.ProcessEnv, name: string): boolean {
  const raw = (env[name] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}
