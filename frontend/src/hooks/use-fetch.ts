import { useCallback, useEffect, useRef, useState } from 'react';

interface UseGetResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  mutate: () => void;
}

const COMPANY_STORAGE_KEY = 'invoicerr_active_company_id';

function getActiveCompanyId(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(COMPANY_STORAGE_KEY);
  }
  return null;
}

export async function authenticatedFetch(
  input: RequestInfo,
  init: RequestInit = {},
): Promise<Response> {
  const activeCompanyId = getActiveCompanyId();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };

  // Add company ID header if available
  if (activeCompanyId) {
    (headers as Record<string, string>)['X-Company-Id'] = activeCompanyId;
  }

  const res = await fetch(input, {
    ...init,
    credentials: 'include',
    headers,
  });

  if (res.status === 401) {
    if (
      !window.location.pathname.includes('/sign-in') &&
      !window.location.pathname.includes('/auth')
    ) {
      window.location.href = '/auth/sign-in';
      console.warn('Session expired or invalid');
    }
  }

  return res;
}

export function useGetRaw<T>(url: string, options?: RequestInit): UseGetResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refetchIndex, setRefetchIndex] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const fullUrl = url.startsWith('http')
      ? url
      : `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

    authenticatedFetch(fullUrl, {
      ...optionsRef.current,
      method: 'GET',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${url} failed: ${res.statusText}`);
        const json = await res.json();
        if (!cancelled) {
          setData(json as T);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url, refetchIndex]);

  const mutate = useCallback(() => setRefetchIndex((i) => i + 1), []);

  return { data, loading, error, mutate };
}

export function useGet<T>(url: string | null, options?: RequestInit): UseGetResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refetchIndex, setRefetchIndex] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }

    const fullUrl = url.startsWith('http')
      ? url
      : `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

    authenticatedFetch(fullUrl, {
      ...optionsRef.current,
      method: 'GET',
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`GET ${url} failed with status ${res.status}`);
        }
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setData(json as T);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url, refetchIndex]);

  const mutate = useCallback(() => setRefetchIndex((i) => i + 1), []);

  return { data, loading, error, mutate };
}

export interface UseSseResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  close: () => void;
}

export function useSse<T>(url: string, options?: EventSourceInit): UseSseResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const fullUrl = url.startsWith('http')
      ? url
      : `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Reset state for new connection
    setData(null);
    setLoading(true);
    setError(null);

    const es = new EventSource(fullUrl, {
      ...optionsRef.current,
      withCredentials: true,
    });

    eventSourceRef.current = es;

    es.onmessage = (event) => {
      setLoading(false);
      try {
        const parsed = JSON.parse(event.data);
        setData(parsed);
      } catch {
        setData(event.data as T);
      }
    };

    es.onerror = (err) => {
      console.error('SSE Error', err);
      setError(new Error('SSE connection error'));
      setLoading(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [url]); // Only depend on URL, options stored in ref

  const close = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  return { data, loading, error, close };
}

type UseRequestOptions<B = unknown> = Omit<RequestInit, 'body'> & { body?: B };

interface UsePostResult<T, B = unknown> {
  trigger: (body?: B, extraOptions?: RequestInit) => Promise<T | null>;
  data: T | null;
  loading: boolean;
  error: Error | null;
}

function createMethodHook(method: string) {
  return function useRequest<T, B = unknown>(
    url: string,
    options: UseRequestOptions<B> = {},
  ): UsePostResult<T, B> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const trigger = async (body?: B, extraOptions: RequestInit = {}): Promise<T | null> => {
      setLoading(true);
      setError(null);

      const fullUrl = url.startsWith('http')
        ? url
        : `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

      // Destructure body from options to avoid type conflict when spreading
      const { body: optionsBody, ...restOptions } = options;

      try {
        const res = await authenticatedFetch(fullUrl, {
          method,
          headers: {
            ...(restOptions.headers || {}),
            ...(extraOptions.headers || {}),
          },
          body: body
            ? JSON.stringify(body)
            : optionsBody
              ? JSON.stringify(optionsBody)
              : undefined,
          ...restOptions,
          ...extraOptions,
        });

        if (!res.ok) throw new Error(`${method} ${url} failed`);

        const json: T = await res.json();
        setData(json);
        return json;
      } catch (err: unknown) {
        setError(err instanceof Error ? err : new Error(String(err)));
        return null;
      } finally {
        setLoading(false);
      }
    };

    return { trigger, data, loading, error };
  };
}

export const usePost = createMethodHook('POST');
export const usePut = createMethodHook('PUT');
export const usePatch = createMethodHook('PATCH');
export const useDelete = createMethodHook('DELETE');

// ============================================================================
// SSE with prefetching for paginated data
// ============================================================================

// Global cache for prefetched pages (shared across hook instances)
const pageCache = new Map<string, { data: unknown; timestamp: number }>();
const PREFETCH_CACHE_TTL = 30000; // 30 seconds

function getCachedPage<T>(cacheKey: string): T | null {
  const cached = pageCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < PREFETCH_CACHE_TTL) {
    return cached.data as T;
  }
  if (cached) {
    pageCache.delete(cacheKey);
  }
  return null;
}

function setCachedPage<T>(cacheKey: string, data: T): void {
  pageCache.set(cacheKey, { data, timestamp: Date.now() });
}

export interface UseSsePaginatedResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  close: () => void;
}

/**
 * SSE hook with prefetching for paginated data
 * @param baseUrl - Base URL without page parameter (e.g., '/api/invoices/sse')
 * @param page - Current page number
 * @param pageCount - Total number of pages (for limiting prefetch)
 */
export function useSsePaginated<T>(
  baseUrl: string,
  page: number,
  pageCount: number = 1,
): UseSsePaginatedResult<T> {
  const [data, setData] = useState<T | null>(() => {
    // Initialize with cached data if available
    const cacheKey = `${baseUrl}?page=${page}`;
    return getCachedPage<T>(cacheKey);
  });
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const prefetchControllerRef = useRef<AbortController | null>(null);

  // Prefetch adjacent pages
  useEffect(() => {
    // Cancel previous prefetch requests
    if (prefetchControllerRef.current) {
      prefetchControllerRef.current.abort();
    }
    prefetchControllerRef.current = new AbortController();
    const signal = prefetchControllerRef.current.signal;

    const pagesToPrefetch = [page - 1, page + 1, page + 2].filter(
      (p) => p >= 1 && p <= pageCount && p !== page,
    );

    const backendUrl = import.meta.env.VITE_BACKEND_URL || '';
    // Convert SSE URL to regular GET URL (remove /sse suffix if present)
    const fetchBaseUrl = baseUrl.replace('/sse', '');

    pagesToPrefetch.forEach((p) => {
      const cacheKey = `${baseUrl}?page=${p}`;
      // Skip if already cached
      if (getCachedPage(cacheKey)) return;

      const fetchUrl = `${backendUrl}${fetchBaseUrl}?page=${p}`;
      authenticatedFetch(fetchUrl, { signal })
        .then(async (res) => {
          if (res.ok) {
            const json = await res.json();
            setCachedPage(cacheKey, json);
          }
        })
        .catch(() => {
          // Ignore prefetch errors (abort or network)
        });
    });

    return () => {
      if (prefetchControllerRef.current) {
        prefetchControllerRef.current.abort();
      }
    };
  }, [baseUrl, page, pageCount]);

  // SSE connection for current page
  useEffect(() => {
    const url = `${baseUrl}?page=${page}`;
    const fullUrl = url.startsWith('http')
      ? url
      : `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

    // Check cache first for instant display
    const cacheKey = `${baseUrl}?page=${page}`;
    const cached = getCachedPage<T>(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setError(null);

    const es = new EventSource(fullUrl, { withCredentials: true });
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      setLoading(false);
      try {
        const parsed = JSON.parse(event.data) as T;
        setData(parsed);
        // Update cache with fresh data
        setCachedPage(cacheKey, parsed);
      } catch {
        setData(event.data as T);
      }
    };

    es.onerror = (err) => {
      console.error('SSE Error', err);
      setError(new Error('SSE connection error'));
      setLoading(false);
      es.close();
    };

    return () => {
      es.close();
    };
  }, [baseUrl, page]);

  const close = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  return { data, loading, error, close };
}
