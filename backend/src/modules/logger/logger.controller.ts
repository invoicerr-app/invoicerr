import { Controller, Query, Sse } from '@nestjs/common';
import { from, interval, type Observable } from 'rxjs';
import { map, startWith, switchMap } from 'rxjs/operators';
import { logger } from '@/logger/logger.service';

interface MessageEvent {
  data: any;
}

@Controller('logs')
export class LoggerController {
  @Sse()
  streamLogs(
    @Query('category') category?: string,
    @Query('level') level?: string,
    @Query('userId') userId?: string,
    @Query('intervalMs') intervalMs?: string,
  ): Observable<MessageEvent> {
    const ms = parseInt(intervalMs || '1000', 10) || 1000;

    return interval(ms).pipe(
      startWith(0),
      switchMap(() =>
        from(
          (async () => {
            const filters: any = {};
            if (category) filters.category = category;
            if (level) filters.level = level;
            if (userId) filters.userId = userId;

            const logs = await logger.fetchLogs(filters, { skip: 0, take: 100 });

            const newLogs = logs
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
              .reverse();

            return newLogs;
          })(),
        ),
      ),
      map((logs) => ({ data: logs })),
    );
  }
}
