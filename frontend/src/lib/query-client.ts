import { QueryClient } from "@tanstack/react-query"

import { ApiError } from "@/hooks/use-api-query"

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: (failureCount, error) => {
                // authenticatedFetch already redirects to /auth/sign-in on 401, no point retrying it
                if (error instanceof ApiError && error.status === 401) return false
                return failureCount < 2
            },
        },
        mutations: {
            retry: false,
        },
    },
})
