import { Injectable } from '@nestjs/common';
import { logger } from '@/logger/logger.service';

@Injectable()
export class CronService {
    async runScheduledTasks(): Promise<void> {
        try {
            // ...existing code...
            logger.info('Scheduled tasks executed', { category: 'cron' });
        } catch (error) {
            logger.error('Error executing scheduled tasks', { category: 'cron', details: { error } });
            throw error;
        }
    }
}