import { Log, LogLevel } from "prisma/generated/prisma/client";

import { Logger } from '@nestjs/common';
import prisma from '@/prisma/prisma.service';

interface LogOptions {
    userId?: string;
    path?: string;
    category: string;
    details?: Record<string, any>;
}

export class LoggerService {
    private prisma = prisma;
    private inLogger = new Logger()

    constructor() {
    }

    private async createLog(
        level: LogLevel,
        message: string,
        options: LogOptions
    ): Promise<Log> {
        try {
            const { category, userId, path, details } = options;

            return this.prisma.log.create({
                data: {
                    level,
                    category,
                    message,
                    userId,
                    path,
                    details: details || {},
                },
            });

        } catch (error) {
            console.error('Erreur lors de l\'enregistrement du log en base de données:', error);
            logger.error('Impossible d\'enregistrer le log.', { category: 'logger', details: { error } });
            throw new Error('Impossible d\'enregistrer le log.');
        }
    }

    public info(message: string, options: Omit<LogOptions, 'details'> & { details?: Record<string, any> }): Promise<Log> {
        this.inLogger.log(`[${options.category}] ${message}`);
        return this.createLog('INFO', message, options);
    }

    public warn(message: string, options: Omit<LogOptions, 'details'> & { details?: Record<string, any> }): Promise<Log> {
        this.inLogger.warn(`[${options.category}] ${message}`);
        return this.createLog('WARN', message, options);
    }

    public error(message: string, options: Omit<LogOptions, 'details'> & { details?: Record<string, any> }): Promise<Log> {
        this.inLogger.error(`[${options.category}] ${message}`);
        const errorDetails = options.details || {};
        if (errorDetails.stack === undefined) {
            errorDetails.stack = new Error().stack;
        }
        return this.createLog('ERROR', message, { ...options, details: errorDetails });
    }

    public debug(message: string, options: Omit<LogOptions, 'details'> & { details?: Record<string, any> }): Promise<Log> {
        if (process.env.NODE_ENV !== 'production' || process.env.FORCE_DEBUG_LOGS === 'true') {
            this.inLogger.debug(`[${options.category}] ${message}`);
        }
        return this.createLog('DEBUG', message, options);
    }

    public async fetchLogs(
        filters: {
            level?: LogLevel;
            category?: string;
            userId?: string;
            startDate?: Date;
            endDate?: Date;
        } = {},
        pagination: { skip: number; take: number } = { skip: 0, take: 50 }
    ): Promise<Log[]> {
        const whereClause: any = {};

        if (filters.level) whereClause.level = filters.level;
        if (filters.category) whereClause.category = filters.category;
        if (filters.userId) whereClause.userId = filters.userId;

        if (filters.startDate || filters.endDate) {
            whereClause.timestamp = {};
            if (filters.startDate) whereClause.timestamp.gte = filters.startDate; // greater than or equal
            if (filters.endDate) whereClause.timestamp.lte = filters.endDate;     // less than or equal
        }

        return this.prisma.log.findMany({
            where: whereClause,
            orderBy: {
                timestamp: 'desc',
            },
            skip: pagination.skip,
            take: pagination.take,
        });
    }
}

export const logger = new LoggerService();