/** The two roles one image runs as (`ROLE` in `entrypoint.sh`). */
export type ProcessRole = 'api' | 'worker';

/**
 * The service name each role reports under, in traces and in the `service` metrics label alike.
 * No imports on purpose: `register-tracing.ts` loads this before anything else is required.
 */
export const SERVICE_NAME: Readonly<Record<ProcessRole, string>> = {
  api: 'invoicerr-api',
  worker: 'invoicerr-worker',
};
