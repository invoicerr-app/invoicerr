import { createAuthClient } from "better-auth/react"

// No genericOAuthClient plugin: since better-auth 1.7 the generic-OAuth plugin registers no
// endpoints of its own, the flow rides on the core `signIn.social` / `callback/:id` endpoints.
// OIDC sign-in therefore goes through `authClient.signIn.social({ provider: <OIDC_NAME> })`.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_BACKEND_URL || "",
  additionalFields: {
    firstname: "",
    lastname: "",
  },
})
