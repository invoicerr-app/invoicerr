/**
 * Minimal HTTP helper shared by every registry provider.
 *
 * Registries are third-party services on the critical path of a form: every call
 * is time-boxed, non-2xx is an error (except the 404 that means "not found"),
 * and nothing here ever throws an unhandled rejection into Nest.
 */
import { ProviderLookupError } from './types';

export const DEFAULT_TIMEOUT_MS = 8000;

/** Identifies us to registries that reject anonymous clients (cvrapi.dk, SEC…). */
export const USER_AGENT = 'invoicerr/1.0 (+https://github.com/Impre-visible/invoicerr)';

export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Statuses to treat as "no such entity" → returns null instead of throwing. */
  notFoundStatuses?: number[];
  /** Parse the body as text instead of JSON (JSONP, CSV, XML providers). */
  raw?: boolean;
}

async function request(url: string, opts: FetchJsonOptions): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ProviderLookupError(
      'PROVIDER_ERROR',
      msg.includes('abort') ? `Registry timed out after ${opts.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` : msg,
    );
  } finally {
    clearTimeout(timer);
  }

  const notFound = opts.notFoundStatuses ?? [404];
  if (notFound.includes(res.status)) return null;
  if (!res.ok) {
    throw new ProviderLookupError('PROVIDER_ERROR', `Registry responded ${res.status} ${res.statusText}`);
  }
  return res;
}

/** GET/POST JSON. Returns null when the registry says "not found". */
export async function fetchJson<T = any>(url: string, opts: FetchJsonOptions = {}): Promise<T | null> {
  const res = await request(url, opts);
  if (!res) return null;
  try {
    return (await res.json()) as T;
  } catch {
    throw new ProviderLookupError('PROVIDER_ERROR', 'Registry returned a malformed JSON body');
  }
}

/** Same contract as `fetchJson`, for registries that answer JSONP / CSV / XML. */
export async function fetchText(url: string, opts: FetchJsonOptions = {}): Promise<string | null> {
  const res = await request(url, opts);
  if (!res) return null;
  return res.text();
}

/** Digits only — the normal form for most national registration numbers. */
export function digits(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Uppercase, no spaces/dots/dashes — the normal form for VAT numbers. */
export function alnum(value: string): string {
  return (value ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

/** Strips a leading ISO country prefix from a VAT number ('FR44732829320' → '44732829320'). */
export function stripVatPrefix(value: string, countryCode: string): string {
  const clean = alnum(value);
  const prefix = countryCode.toUpperCase() === 'GR' ? 'EL' : countryCode.toUpperCase();
  return clean.startsWith(prefix) ? clean.slice(prefix.length) : clean;
}

/** Registries publish dates in many shapes; anything unparseable becomes undefined. */
export function toDate(value: unknown): Date | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}/.test(value) ? value : undefined;
  const dmy = /^(\d{2})\/(\d{2})\s*-\s*(\d{4})$/.exec(value.trim()); // cvrapi.dk: "17/04 - 2000"
  const raw = iso ?? (dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : undefined);
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
