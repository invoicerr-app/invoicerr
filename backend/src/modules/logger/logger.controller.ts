import { Controller, Query, Sse } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Observable, from, interval } from 'rxjs';
import { startWith, switchMap, map } from 'rxjs/operators';
import { logger } from '@/logger/logger.service';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';
import { ActiveCompany } from '@/decorators/active-company.decorator';

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

// `Log.companyId` (see `schema.prisma`'s own comment on it, and `@/logger/logger.service.ts`'s header)
// is now filtered at the DATABASE level below — a real fix, not the `userId`-membership heuristic this
// comment used to describe here: that heuristic surfaced every log line a company's own member ever
// triggered in EVERY company they belong to (not just the one the action was actually taken in), and
// dropped every row with no `userId` at all (a cron/queue-worker log with no human behind it) even when
// it genuinely belonged to this company. Filtering by `companyId` directly closes both: a row is either
// FOR this company or it is not, regardless of who (or what background job) wrote it. A row written
// before this column existed, or one that is genuinely instance-level (`companyId: null` — a boot check
// spanning every company at once), simply never matches any one company's filter — invisible on every
// company's own screen, the same "ambiguous means hidden, never leaked" choice `mentions/`'s own header
// makes for country data, never a reason to fall back to the old, leakier heuristic for those rows.
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

    return interval(ms).pipe(
      startWith(0),
      switchMap(() =>
        from(
          (async () => {
            const filters: any = { companyId };
            if (category) filters.category = category;
            if (level) filters.level = level;
            if (userId) filters.userId = userId;

            // Tenant scoping now happens IN the query itself (`companyId` — see this class's own
            // header) — no more post-fetch membership filter, and no more silently dropping a row that
            // has no `userId` at all (a queue-worker log with no human behind it, now correctly kept
            // when it carries this company's own `companyId`).
            return (await logger.fetchLogs(filters, { skip: 0, take: 100 }))
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
              .reverse();
          })(),
        ),
      ),
      map((logs) => ({ data: logs })),
    );
  }
}
