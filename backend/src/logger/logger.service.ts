import { Log, LogLevel } from 'prisma/generated/prisma/client';

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
  private inLogger = new Logger();

  constructor() {}

  /**
   * Resolves to null when the row could not be written. Callers never await this — a
   * rejected promise would surface as an unhandled rejection, which takes the Node
   * process down. Losing a log line must never cost the request that produced it.
   */
  private async createLog(level: LogLevel, message: string, options: LogOptions): Promise<Log | null> {
    try {
      const { category, userId, path, details } = options;

      // Awaited on purpose: without it the rejection escapes the catch below.
      return await this.prisma.log.create({
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
      // Report through the Nest logger only. Calling logger.error() here would funnel
      // straight back into createLog(), so a database that cannot accept logs — exactly
      // what happens when the schema is being rebuilt under a running app — turned one
      // failure into an endless chain of failing writes.
      this.inLogger.error(`Failed to persist a ${level} log entry: ${message}`, error as Error);
      return null;
    }
  }

  public info(
    message: string,
    options: Omit<LogOptions, 'details'> & { details?: Record<string, any> },
  ): Promise<Log | null> {
    this.inLogger.log(`[${options.category}] ${message}`);
    return this.createLog('INFO', message, options);
  }

  public warn(
    message: string,
    options: Omit<LogOptions, 'details'> & { details?: Record<string, any> },
  ): Promise<Log | null> {
    this.inLogger.warn(`[${options.category}] ${message}`);
    return this.createLog('WARN', message, options);
  }

  public error(
    message: string,
    options: Omit<LogOptions, 'details'> & { details?: Record<string, any> },
  ): Promise<Log | null> {
    this.inLogger.error(`[${options.category}] ${message}`);
    const errorDetails = options.details || {};
    if (errorDetails.stack === undefined) {
      errorDetails.stack = new Error().stack;
    }
    return this.createLog('ERROR', message, { ...options, details: errorDetails });
  }

  public debug(
    message: string,
    options: Omit<LogOptions, 'details'> & { details?: Record<string, any> },
  ): Promise<Log | null> {
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
    pagination: { skip: number; take: number } = { skip: 0, take: 50 },
  ): Promise<Log[]> {
    const whereClause: any = {};

    if (filters.level) whereClause.level = filters.level;
    if (filters.category) whereClause.category = filters.category;
    if (filters.userId) whereClause.userId = filters.userId;

    if (filters.startDate || filters.endDate) {
      whereClause.timestamp = {};
      if (filters.startDate) whereClause.timestamp.gte = filters.startDate; // greater than or equal
      if (filters.endDate) whereClause.timestamp.lte = filters.endDate; // less than or equal
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
