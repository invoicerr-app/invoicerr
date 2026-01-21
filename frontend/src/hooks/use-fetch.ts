import { useEffect, useRef, useState } from 'react';

type UseGetResult<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
  mutate: () => void;
};

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
      console.warn('Session expirée ou invalide');
    }
  }

  return res;
}

export function useGetRaw<T = any>(url: string, options?: RequestInit): UseGetResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const fullUrl = url.startsWith('http')
      ? url
      : `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

    authenticatedFetch(fullUrl, {
      ...options,
      method: 'GET',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${url} failed: ${res.statusText}`);
        if (!cancelled) {
          setData(res as unknown as T);
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
  }, [url, options]);

  return { data, loading, error, mutate: () => {} };
}

export function useGet<T = any>(url: string | null, options?: RequestInit): UseGetResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [_refetchIndex, setRefetchIndex] = useState(0);

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
      ...options,
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
          setData(json);
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
  }, [url, options]);

  return {
    data,
    loading,
    error,
    mutate: () => setRefetchIndex((i) => i + 1),
  };
}

export interface useSseResult<T = any> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  close: () => void;
}

export function useSse<T = any>(url: string, options?: EventSourceInit): useSseResult<T> {
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

type UseRequestOptions = RequestInit & { body?: any };

type UsePostResult<T> = {
  trigger: (body?: any, extraOptions?: RequestInit) => Promise<T | null>;
  data: T | null;
  loading: boolean;
  error: Error | null;
};

function createMethodHook(method: string) {
  return function useRequest<T = any>(
    url: string,
    options: UseRequestOptions = {},
  ): UsePostResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    const trigger = async (body?: any, extraOptions: RequestInit = {}): Promise<T | null> => {
      setLoading(true);
      setError(null);

      const fullUrl = url.startsWith('http')
        ? url
        : `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

      try {
        const res = await authenticatedFetch(fullUrl, {
          method,
          headers: {
            ...(options.headers || {}),
            ...(extraOptions.headers || {}),
          },
          // Gestion intelligente du body : si c'est un objet, on JSON.stringify, sinon on passe tel quel
          body: body
            ? JSON.stringify(body)
            : options.body
              ? JSON.stringify(options.body)
              : undefined,
          ...options,
          ...extraOptions,
        });

        if (!res.ok) throw new Error(`${method} ${url} failed`);

        const json: T = await res.json();
        setData(json);
        return json;
      } catch (err: any) {
        setError(err);
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
