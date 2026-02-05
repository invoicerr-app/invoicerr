import { createAuthClient } from "better-auth/react"
import { genericOAuthClient } from "better-auth/client/plugins"

export const authClient = createAuthClient({
    baseURL: import.meta.env.VITE_BACKEND_URL || '',
    additionalFields: {
        firstname: "",
        lastname: "",
    },
    plugins: [
        genericOAuthClient(),
    ],
})