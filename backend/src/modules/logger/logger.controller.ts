import { Controller, Query, Sse } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Observable, from, interval } from 'rxjs';
import { startWith, switchMap, map } from 'rxjs/operators';
import { logger } from '@/logger/logger.service';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import prisma from '@/prisma/prisma.service';

interface MessageEvent {
  data: any;
}

// The floor a caller-supplied `intervalMs` is clamped to: this handler re-runs a `Log.findMany` query
// on every tick for as long as the SSE connection stays open, so an unbounded value (`intervalMs=1`,
// accepted by a bare `parseInt` with no lower bound) turns one subscriber into roughly one query per
// millisecond — a self-inflicted denial of service, not a legitimate "refresh faster" request.
const MIN_STREAM_INTERVAL_MS = 1000;

/** Pure so the floor is a tested fact rather than an inline expression buried in `streamLogs` — a
 *  missing/non-numeric `raw` falls back to the same 1000ms default `streamLogs` always documented. */
export function clampStreamIntervalMs(raw: string | undefined): number {
  return Math.max(MIN_STREAM_INTERVAL_MS, parseInt(raw || '1000', 10) || 1000);
}

// NOTE: the Log model has no companyId (it predates multi-tenancy and isn't scoped per-company
// anywhere it's written) — adding one is a cross-cutting change touching every `logger.info/warn/
// error()` call site in the app (`@/logger/logger.service.ts`), out of reach for this controller
// alone. `@Roles(OWNER, ADMIN)` only ever limited WHO can open this stream, never WHAT it shows once
// opened, which is what let any company's own OWNER watch every OTHER company's activity — user ids,
// request paths, and whatever free-text `details` a log call happened to attach (a client's contact
// email, a webhook secret…). `streamLogs` below closes the gap it CAN close without that migration:
// the stream is filtered, after the fact, to log rows whose `userId` belongs to the ACTIVE company's
// own membership — a real user this OWNER/ADMIN already has visibility into via the Members screen.
// A row with no `userId` at all (a cron/queue-worker log with no human behind it) is dropped rather
// than shown to every company, the same "ambiguous means hidden, never leaked" choice `mentions/`'s
// own header makes for country data. Residual, and worth naming: a user who belongs to SEVERAL
// companies still has every one of their log lines surface in each of those companies' streams, not
// just the one the action was actually taken in — `Log` has no way to say which company an entry was
// FOR, only who triggered it. Closing that fully needs the same `Log.companyId` migration+backfill
// this comment already flags as out of reach here.
@ApiTags('logs')
@Controller('logs')
@Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
export class LoggerController {
  @Sse()
  @ApiOperation({
    summary: 'Stream application logs',
    description:
      'Server-sent event stream that pushes application logs in real-time, optionally filtered by category, level, or user ID.',
  })
  @ApiQuery({ name: 'category', required: false, type: String, description: 'Filter logs by category' })
  @ApiQuery({
    name: 'level',
    required: false,
    type: String,
    description: 'Filter logs by level (e.g. info, error)',
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    type: String,
    description: 'Filter logs by the user ID that triggered them',
  })
  @ApiQuery({
    name: 'intervalMs',
    required: false,
    type: String,
    description: 'Polling interval in milliseconds for the log stream. Defaults to 1000.',
  })
  streamLogs(
    @ActiveCompany() companyId: string,
    @Query('category') category?: string,
    @Query('level') level?: string,
    @Query('userId') userId?: string,
    @Query('intervalMs') intervalMs?: string,
  ): Observable<MessageEvent> {
    const ms = clampStreamIntervalMs(intervalMs);
    let lastTimestamp = new Date(0);

    return interval(ms).pipe(
      startWith(0),
      switchMap(() =>
        from(
          (async () => {
            // The active company's own current membership — re-read every tick rather than once at
            // subscribe time, so a member added/removed mid-stream is reflected immediately, the same
            // "never trust a stale snapshot" discipline `guards/auth.guard.ts` now applies to API keys.
            const members = await prisma.userCompany.findMany({
              where: { companyId },
              select: { userId: true },
            });
            const memberIds = new Set(members.map((m) => m.userId));

            const filters: any = {};
            if (category) filters.category = category;
            if (level) filters.level = level;
            if (userId) filters.userId = userId;

            const logs = await logger.fetchLogs(filters, { skip: 0, take: 100 });

            // Tenant scoping `Log` cannot do at the query level (it has no `companyId` — see this
            // class's own header): a row with no `userId`, or one belonging to someone outside this
            // company's membership, is dropped rather than shown.
            const scopedLogs = logs.filter((entry) => !!entry.userId && memberIds.has(entry.userId));

            const newLogs = scopedLogs
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
              .reverse();

            if (newLogs.length > 0) {
              const newest = newLogs[newLogs.length - 1];
              lastTimestamp = new Date(newest.timestamp);
            }

            return newLogs;
          })(),
        ),
      ),
      map((logs) => ({ data: logs })),
    );
  }
}
