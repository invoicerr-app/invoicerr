import { Log, LogLevel } from 'prisma/generated/prisma/client';

import { Logger } from '@nestjs/common';
import prisma from '@/prisma/prisma.service';
import { getContextCompanyId } from '@/lib/request-context';

interface LogOptions {
  userId?: string;
  path?: string;
  category: string;
  details?: Record<string, any>;
  /**
   * Which company this row is FOR — see `schema.prisma`'s own `Log.companyId` comment for the full
   * "why every write site needs to answer this" rationale. Almost never passed explicitly: omitting
   * it (the overwhelming majority of call sites) resolves to whatever `@/lib/request-context.ts`'s
   * `AsyncLocalStorage` currently holds — the active company for an authenticated HTTP request
   * (`CompanyContextInterceptor`), or the one a background job/webhook handler explicitly entered via
   * `runWithCompanyId` before calling this. Passed explicitly only where a single function's own
   * logger calls span MORE than one company fact in the same execution (a webhook resolving a
   * DIFFERENT company than the one on its own payload, e.g. `billing/webhook-handlers.ts`'s legacy-
   * customer recovery path) — there, the value already being threaded into `details` for readability
   * is reused here too, never a second, independently-computed value.
   *
   * `null` (as opposed to omitting the key) means "no company — genuinely instance-level", and is
   * never second-guessed against the ambient context by anything other than the test-only guard
   * below: a boot-time check that scans every company's rows at once (`documents.service.ts#
   * onModuleInit`'s `warnAboutUndeclaredStatuses`) has no ambient context to conflict with in the
   * first place, so this is the ordinary, correct path for it — not a hole to close.
   */
  companyId?: string | null;
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
    const contextCompanyId = getContextCompanyId();
    // `undefined` (the ordinary case — see `LogOptions.companyId`'s own header) defers entirely to
    // the ambient request/job context; an explicit value (including `null`) always wins, since the
    // caller that supplied it knows something the ambient context cannot (or is deliberately outside
    // any context at all, e.g. a boot-time check).
    const companyId = options.companyId !== undefined ? options.companyId : contextCompanyId;

    // TEST-ONLY tripwire, never active outside `NODE_ENV=test`, and deliberately OUTSIDE the try/catch
    // below: that catch exists for a failed DB WRITE (see this method's own header — a lost log line
    // must never cost the request that produced it), and would otherwise silently swallow this thrown
    // Error exactly like any other write failure, defeating the whole point of a guard meant to FAIL a
    // test loudly. A call site inside an active-company request/job that explicitly forces
    // `companyId: null` — rather than simply OMITTING the field, which would correctly defer to that
    // same active company — is almost certainly a copy-pasted "instance-level" call site that escaped
    // its own company's scope, silently making that row invisible to the one company's log screen that
    // should have shown it. Deliberately the INVERSE of a naive "companyId must always be set" rule
    // (which would also flag every genuinely instance-level boot log): this only fires on the one shape
    // that is ALWAYS a mistake — a caller that had a real company in hand (the ambient context proves
    // one existed) and threw it away on purpose.
    if (process.env.NODE_ENV === 'test' && options.companyId === null && contextCompanyId !== null) {
      throw new Error(
        `Log write "${message}" explicitly set companyId: null while company "${contextCompanyId}" was ` +
          'active — pass that companyId through (or simply omit the field to inherit it), never force null.',
      );
    }

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
          companyId,
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
      /** Scopes to exactly one company's own rows — see `modules/logger/logger.controller.ts#streamLogs`,
       *  the one caller that passes this, for why a direct DB-level filter now replaces the userId-
       *  membership post-filter that file used to need before this column existed. */
      companyId?: string;
    } = {},
    pagination: { skip: number; take: number } = { skip: 0, take: 50 },
  ): Promise<Log[]> {
    const whereClause: any = {};

    if (filters.level) whereClause.level = filters.level;
    if (filters.category) whereClause.category = filters.category;
    if (filters.userId) whereClause.userId = filters.userId;
    if (filters.companyId) whereClause.companyId = filters.companyId;

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
