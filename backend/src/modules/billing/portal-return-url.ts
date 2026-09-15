/**
 * Split out from `polar-plugin.ts` for one reason only: `polar-plugin.ts` imports `@polar-sh/
 * better-auth`, which Jest cannot even parse (see that file's own `polar-plugin.spec.ts` comment —
 * `@polar-sh/checkout`'s browser-only embed bundle is genuine ESM with no CJS build, and every spec
 * that needs the plugin mocks the whole package rather than importing `polar-plugin.ts` for real).
 * `billing.controller.ts`'s own `POST /billing/portal` needs this exact same fallback return URL
 * (`portal-session.ts`'s header) without dragging that entire import graph into a controller spec that
 * has no reason to mock a better-auth plugin it never touches.
 */
export const FALLBACK_RETURN_URL = (): string =>
  `${process.env.APP_URL ?? 'http://localhost:5173'}/settings/billing`;
