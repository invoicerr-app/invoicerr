import {
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { ApiError } from "./use-api-query"
import { portalFetch } from "./use-portal-fetch"

/**
 * The client portal's own `use-api-query.ts` — identical shape (`ApiError`, `apiFetch`,
 * `useApiQuery`/`useApiMutation`), duplicated rather than parameterized, because the ONE thing that
 * differs (`portalFetch` vs `authenticatedFetch` — see that file's own header) is exactly the kind of
 * thing that must never be a runtime branch a caller could get backwards: a portal screen importing
 * the wrong pair by mistake would silently send the STAFF cookie (or nothing at all) instead of the
 * client's own bearer token. Two small, obviously-named files cost less than one that could be misused.
 */
export async function portalApiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const fullUrl = url.startsWith("http") ? url : `${import.meta.env.VITE_BACKEND_URL || ""}${url}`
  const res = await portalFetch(fullUrl, init)
  if (!res.ok) {
    const body = await res
      .clone()
      .json()
      .catch(() => undefined)
    const message =
      typeof body?.message === "string" ? body.message : `${init?.method || "GET"} ${url} failed`
    throw new ApiError(res.status, message, body)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return res.json()
}

export function usePortalApiQuery<T>(
  key: readonly unknown[],
  url: string,
  options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">,
) {
  return useQuery<T>({
    queryKey: key,
    queryFn: () => portalApiFetch<T>(url),
    ...options,
  })
}

interface UsePortalApiMutationOptions<TVariables, TData>
  extends UseMutationOptions<TData, ApiError, TVariables> {
  invalidateKeys?: (readonly unknown[])[]
}

export function usePortalApiMutation<TVariables = unknown, TData = unknown>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  urlOrFn: string | ((variables: TVariables) => string),
  options?: UsePortalApiMutationOptions<TVariables, TData>,
) {
  const queryClient = useQueryClient()
  const { invalidateKeys, onSuccess, ...mutationOptions } = options ?? {}

  return useMutation<TData, ApiError, TVariables>({
    mutationFn: (variables) => {
      const url = typeof urlOrFn === "function" ? urlOrFn(variables) : urlOrFn
      return portalApiFetch<TData>(url, {
        method,
        body: method !== "DELETE" && variables !== undefined ? JSON.stringify(variables) : undefined,
      })
    },
    ...mutationOptions,
    onSuccess: (data, variables, onMutateResult, context) => {
      for (const queryKey of invalidateKeys ?? []) queryClient.invalidateQueries({ queryKey })
      return onSuccess?.(data, variables, onMutateResult, context)
    },
  })
}
