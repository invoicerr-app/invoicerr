import { Controller, Query, Sse } from '@nestjs/common';
import { Observable, from, interval } from 'rxjs';
import { startWith, switchMap, map } from 'rxjs/operators';
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
        let lastTimestamp = new Date(0);

        return interval(ms).pipe(
            startWith(0),
            switchMap(() => from((async () => {
                const filters: any = {};
                if (category) filters.category = category;
                if (level) filters.level = level;
                if (userId) filters.userId = userId;

                const logs = await logger.fetchLogs(filters, { skip: 0, take: 100 });

                const newLogs = logs
                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                    .reverse();

                if (newLogs.length > 0) {
                    const newest = newLogs[newLogs.length - 1];
                    lastTimestamp = new Date(newest.timestamp);
                }

                return newLogs;
            })())),
            map((logs) => ({ data: logs }))
        );
    }
}
