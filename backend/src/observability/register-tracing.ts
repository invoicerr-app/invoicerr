import { currentProcessRole, SERVICE_NAME } from './service-name';
import { startTracing } from './tracing';

// Imported first by `main.ts` and `worker.ts`, for its side effect only.
startTracing(SERVICE_NAME[currentProcessRole()]);
