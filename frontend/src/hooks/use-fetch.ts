import { useCallback, useEffect, useRef, useState } from 'react';

interface UseGetResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  mutate: () => void;
}

export async function authenticatedFetch(
  input: RequestInfo,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
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

  useEffect(() => {
    const fullUrl = url.startsWith('http')
      ? url
      : `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(fullUrl, {
      ...options,
      withCredentials: true,
    });

    eventSourceRef.current = es;
    setLoading(true);
    setError(null);

    es.onopen = () => {
      // Optionnel : gérer l'ouverture
    };

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
  }, [url, options]);

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
