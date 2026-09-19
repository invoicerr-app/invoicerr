import { createAuthClient } from "better-auth/react"

// No genericOAuthClient plugin: since better-auth 1.7 the generic-OAuth plugin registers no
// endpoints of its own, the flow rides on the core `signIn.social` / `callback/:id` endpoints.
// OIDC sign-in therefore goes through `authClient.signIn.social({ provider: <OIDC_NAME> })`.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BACKEND_URL || "",
  additionalFields: {
    firstname: "",
    lastname: "",
    // The account's own language preference (`User.locale` — backend `lib/auth.ts`'s own
    // additionalFields entry). Declared here purely for typing: it's what lets `signUp.email({
    // locale: ... })` and `session.user.locale` type-check without an `@ts-expect-error`.
    locale: "",
  },
})
