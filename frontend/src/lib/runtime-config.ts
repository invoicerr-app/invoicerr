/**
 * Configuration the browser reads at RUNTIME, from /config.json.
 *
 * `import.meta.env` is baked in at build time, and this project ships one image run against many
 * environments — so `entrypoint.sh` writes /config.json when the container starts and `main.tsx` loads
 * it into `window.__APP_CONFIG__` before rendering anything. This module is the single place that reads
 * it, replacing the copy of `getEnvVariable` that had been inlined separately into sign-in, sign-up and
 * `use-backend-health`.
 */

/** Runtime value first, build-time `import.meta.env` second (which is what `npm run dev` relies on). */
export function getEnvVariable(key: string): string | undefined {
  const runtime = (window as unknown as { __APP_CONFIG__?: Record<string, string | undefined> })
    .__APP_CONFIG__
  return runtime?.[key] || (import.meta.env as unknown as Record<string, string | undefined>)[key]
}

/**
 * The instance-wide OIDC provider id, or undefined when this instance registered none.
 *
 * `entrypoint.sh` publishes this ONLY when the backend actually registered the environment provider
 * (i.e. when OIDC_CLIENT_ID is set), and publishes the same sanitised id the backend registered — see
 * `backend/src/lib/sso-policy.ts#resolveEnvOidcProvider`. So "is there a button" and "what does the
 * button ask for" are one fact here rather than two that can disagree: showing a button for an
 * unregistered provider used to produce PROVIDER_NOT_FOUND, and asking for a different id than the one
 * registered used to produce a callback that matched nothing.
 */
export function envOidcProviderId(): string | undefined {
  const value = getEnvVariable("VITE_OIDC_PROVIDER_ID")
  return value && value.trim().length > 0 ? value : undefined
}

/**
 * Whether this instance accepts ONLY single sign-on.
 *
 * Mirrors `backend/src/lib/sso-policy.ts#isOidcOnly` exactly — "1"/"true", case-insensitive,
 * surrounding whitespace tolerated. The backend is what actually refuses email/password (and refuses
 * `set-password`); this only decides whether to render forms that would fail. Hiding a form is a
 * convenience, never the control.
 */
export function isOidcOnly(): boolean {
  const raw = (getEnvVariable("VITE_OIDC_ONLY") ?? "").trim().toLowerCase()
  return raw === "1" || raw === "true"
}
