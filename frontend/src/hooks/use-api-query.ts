import {
    type UseMutationOptions,
    type UseQueryOptions,
    useMutation,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query"

import { authenticatedFetch } from "./use-fetch"

export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message)
    }
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
    const fullUrl = url.startsWith("http") ? url : `${import.meta.env.VITE_BACKEND_URL || ""}${url}`
    const res = await authenticatedFetch(fullUrl, init)
    if (!res.ok) {
        throw new ApiError(res.status, `${init?.method || "GET"} ${url} failed`)
    }
    if (res.status === 204) {
        return undefined as T
    }
    return res.json()
}

export function useApiQuery<T>(
    key: readonly unknown[],
    url: string,
    options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">,
) {
    return useQuery<T>({
        queryKey: key,
        queryFn: () => apiFetch<T>(url),
        ...options,
    })
}

interface UseApiMutationOptions<TVariables, TData> extends UseMutationOptions<TData, ApiError, TVariables> {
    invalidateKeys?: (readonly unknown[])[]
}

export function useApiMutation<TVariables = unknown, TData = unknown>(
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    urlOrFn: string | ((variables: TVariables) => string),
    options?: UseApiMutationOptions<TVariables, TData>,
) {
    const queryClient = useQueryClient()
    const { invalidateKeys, onSuccess, ...mutationOptions } = options ?? {}

    return useMutation<TData, ApiError, TVariables>({
        mutationFn: (variables) => {
            const url = typeof urlOrFn === "function" ? urlOrFn(variables) : urlOrFn
            return apiFetch<TData>(url, {
                method,
                body: variables !== undefined ? JSON.stringify(variables) : undefined,
            })
        },
        ...mutationOptions,
        onSuccess: (data, variables, onMutateResult, context) => {
            invalidateKeys?.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }))
            return onSuccess?.(data, variables, onMutateResult, context)
        },
    })
}
