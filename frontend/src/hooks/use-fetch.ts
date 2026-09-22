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

  // A `FormData` body (a multipart file upload — see hooks/queries/use-attachments.ts and
  // use-received-invoices.ts) must never carry an explicit "Content-Type: application/json" header:
  // the browser computes its own "multipart/form-data; boundary=..." value from the FormData instance
  // at send time, and a caller-set Content-Type here would silently override that with an outright
  // wrong one — the backend's multer/busboy parser would then see a boundary that doesn't match the
  // body it actually received and refuse the whole request. Every OTHER body shape in this app keeps
  // the default JSON header exactly as before.
  const isFormData = init.body instanceof FormData

  const res = await fetch(fullUrl, {
    ...init,
    credentials: "include",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
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

/** Bounded exponential backoff for `useSse`'s own reconnect below — doubling from 1s up to a 30s
 *  cap, rather than retrying instantly, so a backend that is down for a real reason (a deploy, an
 *  actual outage) isn't hammered by every open tab. */
const SSE_RECONNECT_BASE_MS = 1_000
const SSE_RECONNECT_MAX_MS = 30_000

export function useSse<T = any>(url: string, options?: EventSourceInit): useSseResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set by `close()` below (or by this effect's own cleanup) — checked before every reconnect
  // ATTEMPT, not just once, so an already-scheduled `setTimeout(connect, delay)` from a connection
  // that failed right before something else stopped the stream can never resurrect it.
  const stoppedRef = useRef(false)

  useEffect(() => {
    stoppedRef.current = false
    // Scoped to THIS effect run (one per distinct `url`), not a ref: a fresh URL is a logically
    // different stream, so it starts its own backoff and has no event id of its own yet.
    let reconnectDelay = SSE_RECONNECT_BASE_MS
    let lastEventId: string | undefined

    function connect() {
      if (stoppedRef.current) return

      const fullUrl = url.startsWith("http") ? url : `${import.meta.env.VITE_BACKEND_URL || ""}${url}`
      // A manually re-created EventSource — unlike the browser's OWN internal auto-reconnect, which
      // this hook deliberately bypasses below — starts with no `Last-Event-ID` request header of its
      // own: a plain EventSource accepts no custom headers at all, so a query param is the only
      // channel left to carry it. A no-op against every stream in this codebase today (each one emits
      // pure "go re-fetch" nudges with no `id:` field — see documents.controller.ts's own
      // `MessageEvent`), but future-proofs the first one that starts sending an id and wants a
      // reconnecting client to resume from it instead of silently skipping whatever it missed.
      const connectUrl = lastEventId
        ? `${fullUrl}${fullUrl.includes("?") ? "&" : "?"}lastEventId=${encodeURIComponent(lastEventId)}`
        : fullUrl

      const es = new EventSource(connectUrl, {
        ...options,
        withCredentials: true,
      })

      eventSourceRef.current = es
      setLoading(true)
      setError(null)

      es.onopen = () => {
        // A connection actually succeeded — forget any backoff built up by earlier failures, so the
        // NEXT drop starts fast again instead of inheriting a delay stretched out by an unrelated,
        // already-resolved outage.
        reconnectDelay = SSE_RECONNECT_BASE_MS
      }

      es.onmessage = (event) => {
        setLoading(false)
        if (event.lastEventId) lastEventId = event.lastEventId
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
        // Closing here is what disables the BROWSER's own native auto-reconnect — reopening it
        // ourselves, after the bounded delay above, is the entire point: a restarted backend, a 2s
        // Wi-Fi drop, or a corporate proxy that kills long-lived connections used to leave this
        // stream permanently dead for the rest of the session, with no code path ever recovering it.
        // `useDocumentEventsSse`'s own header explicitly (and, before this fix, wrongly) relied on
        // "the browser's own auto-reconnect" for exactly this.
        es.close()
        if (stoppedRef.current) return
        const delay = reconnectDelay
        reconnectDelay = Math.min(delay * 2, SSE_RECONNECT_MAX_MS)
        reconnectTimeoutRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      stoppedRef.current = true
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      eventSourceRef.current?.close()
      eventSourceRef.current = null
    }
  }, [url])

  const close = () => {
    stoppedRef.current = true
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
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

/** A body already in a shape `fetch` accepts as-is — `JSON.stringify`-ing any of these would mangle
 *  it (a `FormData` becomes the useless string `"{}"`, since `JSON.stringify` only sees its own
 *  non-enumerable internals). `createMethodHook`'s own `trigger` only serializes what falls through
 *  this check — a plain object/array. */
function isPreSerializedBody(value: unknown): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof FormData ||
    value instanceof Blob ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof URLSearchParams
  )
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
        const rawBody = body !== undefined ? body : options.body
        // Objects are serialized to JSON; a body already in a wire-ready shape (FormData, string,
        // Blob…) is passed through as-is instead.
        const serializedBody =
          rawBody === undefined ? undefined : isPreSerializedBody(rawBody) ? rawBody : JSON.stringify(rawBody)

        // `headers`/`body` are spread AFTER `...options`/`...extraOptions`, not before: an object
        // literal keeps the LAST occurrence of a key, so a caller's own raw `options.headers` (a plain
        // object, never merged with `extraOptions.headers`) or `options.body` (unserialized) would
        // otherwise silently win over the merge/serialization computed above and above them — dormant
        // until the first caller actually passed either, then a duplicate-key footgun with no error at
        // all: the LATER `...options`/`...extraOptions` spread simply overwrote the correct headers
        // and body with the raw, unmerged ones.
        const res = await authenticatedFetch(fullUrl, {
          ...options,
          ...extraOptions,
          method,
          headers: {
            ...(options.headers || {}),
            ...(extraOptions.headers || {}),
          },
          body: serializedBody,
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
