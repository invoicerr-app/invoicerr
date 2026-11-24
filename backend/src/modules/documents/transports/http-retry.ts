/**
 * The backoff shared by the HTTP clients of the transports (A-Cube, Iopole, KSeF, SuperPDP).
 *
 * Only the delay, the wait and the reading of a response body are shared. Each client keeps its own
 * retry loop, because the rules for WHEN to retry differ: SuperPDP has single-attempt calls
 * (`retry: false`), and SuperPDP, A-Cube and Iopole drop their cached token on a 401 while KSeF's
 * fetch client has no token to drop. Before this file, the same
 * `Math.min(500 * 2 ** (attempt - 1), 5_000)` and the same private `sleep` were written in each of the
 * four clients.
 */

/** Exponential backoff before retry number `attempt` (1-based): 500 ms, 1 s, 2 s, 4 s, then 5 s max. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 5_000);
}

export { sleep } from '@/lib/sleep';

/**
 * Reads a response body: parsed JSON when the `content-type` says so, the raw text otherwise, and
 * `undefined` for an empty text body. Iopole, SuperPDP and the KSeF fetch client each had this exact
 * block. A-Cube keeps its own `readBody`, which tolerates a JSON content type over a body that does
 * not parse, so it does not use this one.
 */
export async function readResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return await res.json();
  }
  const text = await res.text();
  return text || undefined;
}
