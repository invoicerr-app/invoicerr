/**
 * Proves `app.module.ts`'s own `ThrottlerModule.forRoot(...)` call actually wires a Redis-backed
 * storage — not the package's in-memory default — which is the whole fix for the "every limit
 * becomes 3x, and which replica you land on decides whether you are throttled" defect three
 * unsynchronised in-process counters produce across three API replicas. Reading
 * `AppModule`'s own `imports` metadata (rather than booting a `TestingModule` around the whole app,
 * which would try to construct every provider in this large graph, several against a real Postgres)
 * is enough: `@Module({ imports: [...] })`'s array is evaluated at CLASS-DEFINITION time — i.e. the
 * moment this file imports `AppModule` — so `ThrottlerModule.forRoot(...)`'s own return value,
 * `storage` instance included, already exists in that metadata with no Nest bootstrap required.
 *
 * `AppModule` itself CAN be imported directly under this project's test runner (unlike some other
 * modules in this codebase that avoid it — see e.g. `billing.module.spec.ts`'s own header for a
 * DIFFERENT, `ts-jest`-specific gap): confirmed by this file existing and passing at all.
 */
import 'reflect-metadata';

import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
// Not exported from '@nestjs/throttler''s public entry point, so the metadata key is read from its
// own internal module — the same "read a third party's own key, documented" discipline
// `billing.module.spec.ts`'s own `BULLMQ_PROCESSOR_METADATA_KEY` comment already holds.
import { THROTTLER_OPTIONS } from '@nestjs/throttler/dist/throttler.constants';

import { AppModule } from './app.module';

interface ThrottlerOptionsProvider {
  provide: string;
  useValue: { storage?: unknown };
}
interface DynamicModuleLike {
  providers?: ThrottlerOptionsProvider[];
}

describe("AppModule's ThrottlerModule wiring", () => {
  it('registers a Redis-backed ThrottlerStorage, never the in-memory default', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as DynamicModuleLike[];
    const throttlerDynamicModule = imports.find((candidate) =>
      candidate?.providers?.some((provider) => provider.provide === THROTTLER_OPTIONS),
    );
    expect(throttlerDynamicModule).toBeDefined();

    const optionsProvider = throttlerDynamicModule!.providers!.find(
      (provider) => provider.provide === THROTTLER_OPTIONS,
    )!;

    // Three API replicas sharing this SAME class of storage, pointed at the same Redis, is the actual
    // guarantee — see `app.module.ts`'s own comment on this call site for why the in-memory default
    // (what this would be if `storage` were simply omitted) breaks that guarantee entirely.
    expect(optionsProvider.useValue.storage).toBeInstanceOf(ThrottlerStorageRedisService);
  });
});
