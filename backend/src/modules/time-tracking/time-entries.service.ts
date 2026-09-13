import { DocumentInstance, Prisma, TimeEntry } from '../../../prisma/generated/prisma/client';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { fromMinor, toMinor } from '@/utils/financial';

import { computeGeneratedInvoiceLines, TimeEntryForBilling } from './generate-invoice-lines';
import { resolveCompanyCurrency } from './resolve-company-currency';

export interface CreateTimeEntryDto {
  projectId: string;
  /** ISO date (yyyy-mm-dd or a full timestamp — `new Date(...)` parses either). */
  date: string;
  durationMinutes: number;
  description?: string;
  /** Defaults to true — most logged time is billable; an internal meeting is the exception, not the
   *  rule, so a caller has to opt OUT rather than everyone opting in every time. */
  billable?: boolean;
  /** MAJOR units — see resolve-company-currency.ts's own header; null clears any override. */
  hourlyRate?: number | null;
}

export interface EditTimeEntryDto {
  date?: string;
  durationMinutes?: number;
  description?: string | null;
  billable?: boolean;
  hourlyRate?: number | null;
}

export interface GenerateInvoiceDto {
  clientId: string;
  entryIds: string[];
}

export interface TimeEntryProjectSummary {
  id: string;
  name: string;
  clientId: string;
}

const PROJECT_SELECT = { id: true, name: true, clientId: true, hourlyRateMinor: true } as const;

/** A TimeEntry as this module hands it back — `hourlyRate` in MAJOR units (see ProjectsService's own
 *  `ProjectWithRate` for the identical boundary), plus the owning project's own name/client so a list
 *  screen never needs a second round trip per row.
 *
 *  TWO rate fields, deliberately not one:
 *   - `hourlyRate` is this entry's OWN override, possibly null — what an edit form must show, so
 *     re-opening and saving an entry that never set one doesn't silently bake the project's current
 *     default in as a hard per-entry override.
 *   - `effectiveHourlyRate` is what `generate-invoice-lines.ts#computeGeneratedInvoiceLines` will
 *     ACTUALLY bill at (this entry's own override, falling back to the project's default) — what a
 *     list screen or the "generate invoice" preview must show for the amount to match the real
 *     invoice line to the cent, computed the exact same way here as it will be at billing time. */
export type TimeEntryWithRate = Omit<TimeEntry, 'hourlyRateMinor'> & {
  hourlyRate: number | null;
  effectiveHourlyRate: number | null;
  project: TimeEntryProjectSummary;
};

type RawTimeEntry = TimeEntry & {
  project: { id: string; name: string; clientId: string; hourlyRateMinor: number | null };
};

function withRate(entry: RawTimeEntry, currency: string): TimeEntryWithRate {
  const { hourlyRateMinor, project, ...rest } = entry;
  const { hourlyRateMinor: projectHourlyRateMinor, ...projectSummary } = project;
  const effectiveMinor = hourlyRateMinor ?? projectHourlyRateMinor;
  return {
    ...rest,
    hourlyRate: hourlyRateMinor !== null ? fromMinor(hourlyRateMinor, currency) : null,
    effectiveHourlyRate: effectiveMinor !== null ? fromMinor(effectiveMinor, currency) : null,
    project: projectSummary,
  };
}

/** Thrown ONLY inside the transaction in `billToInvoice` below, to force a rollback without that
 *  rollback surfacing as an unhandled error — the exact same shape
 *  numbering/sequence.ts's own `AlreadyNumberedError` already holds for `takeDocumentNumber`. */
class TimeEntriesAlreadyBilledRaceError extends Error {}

/**
 * TODO_FEATURES.md rank 11 — logging time against a Project and turning it into invoice lines. See
 * ProjectsService's own header for why a project layer exists between Client and TimeEntry at all.
 *
 * The property this module protects hardest: an entry can be billed EXACTLY ONCE. `billToInvoice`
 * below is the only place `TimeEntry.invoiceId` is ever set, inside a transaction shared with the
 * invoice's own creation — see that method's own header for the Postgres row-locking argument this
 * rests on. A billed entry additionally becomes READ-ONLY (`assertNotBilled` below, checked by
 * `update`/`remove`) — once its numbers fed a real invoice line, silently changing them out from under
 * that line would make the invoice lie about the work it actually bills for.
 */
@Injectable()
export class TimeEntriesService {
  private async findOwnedProject(companyId: string, projectId: string) {
    const project = await prisma.project.findFirst({ where: { id: projectId, companyId } });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  private assertNotBilled(entry: TimeEntry): void {
    if (entry.invoiceId !== null) {
      throw new ConflictException(
        'This time entry has already been billed and can no longer be edited or deleted.',
      );
    }
  }

  private assertValidDuration(durationMinutes: number): void {
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      throw new BadRequestException('Duration must be a positive whole number of minutes.');
    }
  }

  async create(companyId: string, dto: CreateTimeEntryDto): Promise<TimeEntryWithRate> {
    this.assertValidDuration(dto.durationMinutes);
    const project = await this.findOwnedProject(companyId, dto.projectId);
    const currency = await resolveCompanyCurrency(companyId);

    const entry = await prisma.timeEntry.create({
      data: {
        companyId,
        projectId: project.id,
        date: new Date(dto.date),
        durationMinutes: dto.durationMinutes,
        description: dto.description ?? null,
        billable: dto.billable ?? true,
        hourlyRateMinor: dto.hourlyRate != null ? toMinor(dto.hourlyRate, currency) : null,
      },
      include: { project: { select: PROJECT_SELECT } },
    });

    logger.info('Time entry logged', {
      category: 'time-tracking',
      details: { entryId: entry.id, projectId: project.id, companyId },
    });
    return withRate(entry, currency);
  }

  async findAll(
    companyId: string,
    opts: { projectId?: string; clientId?: string; unbilledOnly?: boolean } = {},
  ): Promise<TimeEntryWithRate[]> {
    const currency = await resolveCompanyCurrency(companyId);
    const entries = await prisma.timeEntry.findMany({
      where: {
        companyId,
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        ...(opts.clientId ? { project: { clientId: opts.clientId } } : {}),
        ...(opts.unbilledOnly ? { invoiceId: null, billable: true } : {}),
      },
      include: { project: { select: PROJECT_SELECT } },
      orderBy: { date: 'desc' },
    });
    return entries.map((entry) => withRate(entry, currency));
  }

  async update(companyId: string, id: string, dto: EditTimeEntryDto): Promise<TimeEntryWithRate> {
    const existing = await prisma.timeEntry.findFirst({ where: { id, companyId } });
    if (!existing) {
      throw new NotFoundException('Time entry not found');
    }
    this.assertNotBilled(existing);
    if (dto.durationMinutes !== undefined) {
      this.assertValidDuration(dto.durationMinutes);
    }
    const currency = await resolveCompanyCurrency(companyId);

    const updated = await prisma.timeEntry.update({
      where: { id },
      data: {
        date: dto.date !== undefined ? new Date(dto.date) : existing.date,
        durationMinutes: dto.durationMinutes ?? existing.durationMinutes,
        description: dto.description !== undefined ? dto.description : existing.description,
        billable: dto.billable ?? existing.billable,
        hourlyRateMinor:
          dto.hourlyRate !== undefined
            ? dto.hourlyRate !== null
              ? toMinor(dto.hourlyRate, currency)
              : null
            : existing.hourlyRateMinor,
      },
      include: { project: { select: PROJECT_SELECT } },
    });

    return withRate(updated, currency);
  }

  async remove(companyId: string, id: string): Promise<{ id: string }> {
    const existing = await prisma.timeEntry.findFirst({ where: { id, companyId } });
    if (!existing) {
      throw new NotFoundException('Time entry not found');
    }
    this.assertNotBilled(existing);
    await prisma.timeEntry.delete({ where: { id } });
    return { id };
  }

  /**
   * Atomically turns every entry in `dto.entryIds` into one invoice line each on a brand-new DRAFT
   * invoice, and marks all of them billed — the ONE operation in this module allowed to write
   * `TimeEntry.invoiceId`. Bypasses `DocumentsService.runAction`/`validateAgainstDescriptor`
   * entirely, on the SAME precedent `actions/quote-to-invoice.ts#createDraftInvoiceFromQuote` already
   * established for "convert-to-invoice"/"request-deposit" (direct `documentInstance.create`, no
   * descriptor validation) — the two differ only in what feeds `data.lines`.
   *
   * ## Why this is safe against double-billing
   * The pre-flight checks below (existence, already-billed, non-billable, wrong-client, no-rate) are
   * for a FAST, FRIENDLY error on the common case — they are NOT what actually prevents two concurrent
   * requests from both billing the same entry. The real guarantee is the single
   * `UPDATE "TimeEntry" ... WHERE "invoiceId" IS NULL` inside the transaction below: Postgres takes a
   * row lock on every matched entry for the duration of the transaction, so a SECOND, concurrent
   * transaction racing over the SAME entry blocks until the first commits, then re-evaluates its own
   * `WHERE invoiceId IS NULL` and finds it now false — its own `updateMany` count comes up short, it
   * throws, and the WHOLE transaction (invoice included) rolls back. This is the exact same argument
   * `numbering/sequence.ts`'s own header makes for why `bumpSequence` needs no `Serializable`
   * isolation to be safe under Postgres's default `READ COMMITTED`.
   */
  async billToInvoice(
    companyId: string,
    dto: GenerateInvoiceDto,
  ): Promise<{ invoice: DocumentInstance; billedEntryIds: string[] }> {
    const entryIds = Array.from(new Set(dto.entryIds ?? []));
    if (entryIds.length === 0) {
      throw new BadRequestException('Select at least one time entry to bill.');
    }

    const client = await prisma.client.findFirst({ where: { id: dto.clientId, companyId } });
    if (!client) {
      throw new NotFoundException('Client not found');
    }

    const entries = await prisma.timeEntry.findMany({
      where: { id: { in: entryIds }, companyId },
      include: { project: { select: PROJECT_SELECT } },
    });
    if (entries.length !== entryIds.length) {
      throw new BadRequestException('One or more selected time entries do not exist for this company.');
    }
    const alreadyBilled = entries.filter((entry) => entry.invoiceId !== null);
    if (alreadyBilled.length > 0) {
      throw new ConflictException({
        message: 'One or more selected time entries have already been billed.',
        entryIds: alreadyBilled.map((entry) => entry.id),
      });
    }
    const notBillable = entries.filter((entry) => !entry.billable);
    if (notBillable.length > 0) {
      throw new BadRequestException({
        message: 'One or more selected time entries are marked non-billable.',
        entryIds: notBillable.map((entry) => entry.id),
      });
    }
    const wrongClient = entries.filter((entry) => entry.project.clientId !== dto.clientId);
    if (wrongClient.length > 0) {
      throw new BadRequestException(
        'Every selected time entry must belong to a project of the given client.',
      );
    }

    const currency = await resolveCompanyCurrency(companyId);
    const forBilling: TimeEntryForBilling[] = entries.map((entry) => ({
      id: entry.id,
      projectName: entry.project.name,
      durationMinutes: entry.durationMinutes,
      description: entry.description,
      hourlyRateMinor: entry.hourlyRateMinor,
      projectHourlyRateMinor: entry.project.hourlyRateMinor,
    }));
    const { lines, errors } = computeGeneratedInvoiceLines(forBilling, currency);
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Some time entries cannot be billed yet.', errors });
    }

    try {
      const invoice = await prisma.$transaction(async (tx) => {
        // Created FIRST, not after the claim: `TimeEntry.invoiceId`'s FK must reference a row that
        // already exists — Postgres checks a foreign key at the end of EACH statement, not the end of
        // the transaction, so the invoice has to exist before the claim below can point at it.
        const created = await tx.documentInstance.create({
          data: {
            companyId,
            typeId: 'invoice',
            status: 'draft',
            data: {
              client: dto.clientId,
              issueDate: new Date().toISOString(),
              currency,
              lines,
            } as Prisma.InputJsonValue,
            lastActionError: null,
          },
        });

        const claimed = await tx.timeEntry.updateMany({
          where: { id: { in: entryIds }, companyId, invoiceId: null },
          data: { invoiceId: created.id },
        });
        if (claimed.count !== entryIds.length) {
          throw new TimeEntriesAlreadyBilledRaceError();
        }

        return created;
      });

      logger.info('Time entries billed to a new invoice draft', {
        category: 'time-tracking',
        details: { companyId, invoiceId: invoice.id, entryCount: entryIds.length },
      });
      return { invoice, billedEntryIds: entryIds };
    } catch (error) {
      if (error instanceof TimeEntriesAlreadyBilledRaceError) {
        throw new ConflictException(
          'One or more selected time entries were billed by another request just now — reload and try again.',
        );
      }
      throw error;
    }
  }
}
