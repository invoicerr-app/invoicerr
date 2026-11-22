import { startTracing } from './tracing';

// Imported first by `main.ts` and `worker.ts`, for its side effect only.
startTracing(process.env.ROLE === 'worker' ? 'invoicerr-worker' : 'invoicerr-api');
