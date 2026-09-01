/**
 * Runs `upsertB2gRoutingRules` on EVERY backend boot — the actual "AU BOOT" half of the mechanism
 * (`boot-upsert.ts` is the pure DB-touching function this wraps). See `schema.prisma`'s own comment
 * on `B2gRoutingRule` for the full "why boot, not `prisma/seed.ts`" reasoning.
 *
 * Modeled directly on `documents/queue/redis-required.guard.ts` (an `OnModuleInit` provider that logs
 * a loud, named line the moment the app is ready) and on
 * `document-queue-worker.module.ts`'s own `onApplicationBootstrap` (which registers the recurrence
 * sweep repeatable on EVERY process that imports that module) — same idempotence guarantee applies
 * here: `upsertB2gRoutingRules` is safe to run on EVERY process that boots (the API inline, or every
 * scaled worker replica importing `DocumentsCoreModule`), never a double-write race, because each
 * row's identity is `countryCode` alone and an upsert converges regardless of how many processes run
 * it concurrently or how many times.
 *
 * Registered directly in `DocumentsCoreModule` (not gated behind `WORKER_INLINE` the way the queue's
 * OWN repeatable registration is) — DELIBERATELY: unlike a BullMQ repeatable job (which only NEEDS to
 * be registered once per cluster, hence the queue module's own gate), THIS upsert's whole point is
 * that every process — API or worker, however many replicas — brings the table to match its OWN
 * loaded code the moment it starts, so no replica is ever left running against a stale rule after a
 * deploy that changed `data/*.json`.
 *
 * NEVER throws: a startup-time DB hiccup here must not crash the whole app the way an unreachable
 * Redis does (`redis-required.guard.ts`'s own, deliberately DIFFERENT choice) — a stale/missing B2G
 * rule table degrades to "no B2G rule declared" at send time (a loud, honest, per-invoice refusal —
 * see `b2g-routing.ts`'s own header), never a silent B2B fallback, so failing OPEN at send time is
 * itself the safety net; failing the whole boot on a transient DB blip would be strictly worse for a
 * feature this narrow.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { upsertB2gRoutingRules } from './boot-upsert';

@Injectable()
export class B2gRoutingBootUpsertService implements OnModuleInit {
  private readonly logger = new Logger(B2gRoutingBootUpsertService.name);

  async onModuleInit(): Promise<void> {
    try {
      const summary = await upsertB2gRoutingRules(prisma);
      this.logger.log(
        `B2G routing rules upserted at boot: ${summary.upserted} upserted, ${summary.deleted} deleted (stale).`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to upsert B2G routing rules at boot — a government client may see "no B2G rule ' +
          `declared" until this succeeds on a later boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
