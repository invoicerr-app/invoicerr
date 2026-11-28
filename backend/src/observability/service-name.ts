/** The two roles one image runs as (`ROLE` in `entrypoint.sh`). */
export type ProcessRole = 'api' | 'worker';

/**
 * This process's role, read from `ROLE` the way `entrypoint.sh`'s own switch reads it: `worker` for
 * the dedicated worker process, unset or anything else defaults to `api`.
 */
export function currentProcessRole(env: NodeJS.ProcessEnv = process.env): ProcessRole {
  return env.ROLE === 'worker' ? 'worker' : 'api';
}

/**
 * The service name each role reports under, in traces and in the `service` metrics label alike.
 * No imports on purpose: `register-tracing.ts` loads this before anything else is required.
 */
export const SERVICE_NAME: Readonly<Record<ProcessRole, string>> = {
  api: 'invoicerr-api',
  worker: 'invoicerr-worker',
};
