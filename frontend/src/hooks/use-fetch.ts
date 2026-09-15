import { useEffect, useRef, useState } from "react"

type UseGetResult<T> = {
  data: T | null
  loading: boolean
  error: Error | null
  mutate: () => void
}

export async function authenticatedFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const fullUrl =
    typeof input === "string" && !input.startsWith("http")
      ? `${import.meta.env.VITE_BACKEND_URL || ""}${input}`
      : input

  const res = await fetch(fullUrl, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  })

  if (res.status === 401) {
    if (!window.location.pathname.includes("/sign-in") && !window.location.pathname.includes("/auth")) {
      window.location.href = "/auth/sign-in"
      console.warn("Session expirée ou invalide")
    }
  }

  return res
}

export function useGetRaw<T = any>(url: string | null, options?: RequestInit): UseGetResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [refetchIndex, setRefetchIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!url) {
      setData(null)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)

    const fullUrl = url.startsWith("http") ? url : `${import.meta.env.VITE_BACKEND_URL || ""}${url}`

    authenticatedFetch(fullUrl, {
      ...options,
      method: "GET",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${url} failed: ${res.statusText}`)
        if (!cancelled) {
          setData(res as unknown as T)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [url, refetchIndex])

  return { data, loading, error, mutate: () => setRefetchIndex((i) => i + 1) }
}

export function useGet<T = any>(url: string | null, options?: RequestInit): UseGetResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [refetchIndex, setRefetchIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    if (!url) {
      setData(null)
      setLoading(false)
      return
    }

    const fullUrl = url.startsWith("http") ? url : `${import.meta.env.VITE_BACKEND_URL || ""}${url}`

    authenticatedFetch(fullUrl, {
      ...options,
      method: "GET",
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`GET ${url} failed with status ${res.status}`)
        }
        return res.json()
      })
      .then((json) => {
        if (!cancelled) {
          setData(json)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [url, refetchIndex])

  return {
    data,
    loading,
    error,
    mutate: () => setRefetchIndex((i) => i + 1),
  }
}

export interface useSseResult<T = any> {
  data: T | null
  loading: boolean
  error: Error | null
  close: () => void
}

export function useSse<T = any>(url: string, options?: EventSourceInit): useSseResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const fullUrl = url.startsWith("http") ? url : `${import.meta.env.VITE_BACKEND_URL || ""}${url}`

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const es = new EventSource(fullUrl, {
      ...options,
      withCredentials: true,
    })

    eventSourceRef.current = es
    setLoading(true)
    setError(null)

    es.onopen = () => {
      // Optional: handle the open event
    }

    es.onmessage = (event) => {
      setLoading(false)
      try {
        const parsed = JSON.parse(event.data)
        setData(parsed)
      } catch {
        setData(event.data as T)
      }
    }

    es.onerror = (err) => {
      console.error("SSE Error", err)
      setError(new Error("SSE connection error"))
      setLoading(false)
      es.close()
    }

    return () => {
      es.close()
    }
  }, [url])

  const close = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
  }

  return { data, loading, error, close }
}

type UseRequestOptions = RequestInit & { body?: any }

/** An `Error` enriched with the failed response's own `code`/`status`, when it had a JSON body — see
 *  `createMethodHook`'s own `!res.ok` branch below. */
export interface ApiHookError extends Error {
  code?: string
  status?: number
}

type UsePostResult<T> = {
  trigger: (body?: any, extraOptions?: RequestInit) => Promise<T | null>
  data: T | null
  loading: boolean
  error: Error | null
  /** The SAME error `trigger`'s catch just set, exposed as a ref rather than only as the `error` state
   *  above. `trigger` never throws (see its own comment) — a caller wrapping it (`useMutationWithToast`)
   *  needs the actual error right after `await`ing `trigger`, but reading THIS render's `error` state
   *  in that same tick would only see the STALE pre-call value (the component hasn't re-rendered to
   *  receive the fresh one yet). The ref object itself is stable across renders, so `.current` is
   *  already up to date the instant the catch block below runs, no re-render required. */
  lastError: { current: ApiHookError | null }
}

function createMethodHook(method: string) {
  return function useRequest<T = any>(url: string, options: UseRequestOptions = {}): UsePostResult<T> {
    const [data, setData] = useState<T | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const lastError = useRef<ApiHookError | null>(null)

    const trigger = async (body?: any, extraOptions: RequestInit = {}): Promise<T | null> => {
      setLoading(true)
      setError(null)
      lastError.current = null

      const fullUrl = url.startsWith("http") ? url : `${import.meta.env.VITE_BACKEND_URL || ""}${url}`

      try {
        const res = await authenticatedFetch(fullUrl, {
          method,
          headers: {
            ...(options.headers || {}),
            ...(extraOptions.headers || {}),
          },
          // Objects are serialized to JSON; anything else (FormData, string…) is passed through as is
          body: body ? JSON.stringify(body) : options.body ? JSON.stringify(options.body) : undefined,
          ...options,
          ...extraOptions,
        })

        if (!res.ok) {
          // Nest exceptions (ForbiddenException, ConflictException, ...) reply with a JSON body
          // carrying `{ message, code? }` — parsed here, best-effort, so a caller can show the
          // SERVER's own specific message (e.g. `billing/write-gate.ts`'s `COMPANY_BLOCKED`) instead
          // of the generic fallback below. Mirrors `use-api-query.ts#apiFetch`'s own `ApiError`.
          const responseBody = await res
            .clone()
            .json()
            .catch(() => undefined)
          const message =
            typeof responseBody?.message === "string" ? responseBody.message : `${method} ${url} failed`
          const err: ApiHookError = new Error(message)
          if (typeof responseBody?.code === "string") err.code = responseBody.code
          err.status = res.status
          throw err
        }

        // Some endpoints reply 200 with an empty body; treat that as
        // success instead of letting res.json() throw and make the
        // mutation look like a failure (trigger resolves null on error).
        const text = await res.text()
        const json: T = text ? JSON.parse(text) : ({} as T)
        setData(json)
        return json
      } catch (err: any) {
        lastError.current = err
        setError(err)
        return null
      } finally {
        setLoading(false)
      }
    }

    return { trigger, data, loading, error, lastError }
  }
}

export const usePost = createMethodHook("POST")
export const usePut = createMethodHook("PUT")
export const usePatch = createMethodHook("PATCH")
export const useDelete = createMethodHook("DELETE")
