/**
 * The backoff shared by the HTTP clients of the transports (A-Cube, Iopole, KSeF, SuperPDP).
 *
 * Only the delay and the wait are shared. Each client keeps its own retry loop, because the rules for
 * WHEN to retry differ: SuperPDP has single-attempt calls (`retry: false`) and refreshes its token on a
 * 401, the others do not. Before this file, the same `Math.min(500 * 2 ** (attempt - 1), 5_000)` and
 * the same private `sleep` were written in each of the four clients.
 */

/** Exponential backoff before retry number `attempt` (1-based): 500 ms, 1 s, 2 s, 4 s, then 5 s max. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 5_000);
}

export { sleep } from '@/lib/sleep';
