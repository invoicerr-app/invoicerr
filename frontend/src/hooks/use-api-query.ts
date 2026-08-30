import {
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"

import { authenticatedFetch } from "./use-fetch"

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** The parsed JSON error body, when the response had one (e.g. `{ message, errors }` from a
     *  Nest exception) — lets a caller show more than the top-line message when it needs to. */
    public body?: unknown,
  ) {
    super(message)
  }
}

/** Exported so a hook that needs to fan out to SEVERAL queries at once (e.g. a multi-target
 *  'reference' field searching across every entity it allows — see useMultiEntityReferenceSearch)
 *  can build each one with `useQueries` instead of duplicating this fetch/error-shape logic. */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const fullUrl = url.startsWith("http") ? url : `${import.meta.env.VITE_BACKEND_URL || ""}${url}`
  const res = await authenticatedFetch(fullUrl, init)
  if (!res.ok) {
    // Nest exceptions (NotFoundException, ConflictException, NotImplementedException, ...) reply
    // with a JSON body carrying a human-readable `message` — surfacing it is what turns "an action
    // is blocked" from a fact only the server log knows into something the caller can show.
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
        // DELETE requests never carry a body in this codebase's convention; a bare
        // JSON primitive (e.g. just an id string) as the whole body is also rejected
        // outright by body-parser's default strict mode (only objects/arrays allowed).
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
