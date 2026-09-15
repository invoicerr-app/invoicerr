import { Project } from '../../../prisma/generated/prisma/client';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { fromMinor, toMinor } from '@/utils/financial';

import { resolveCompanyCurrency } from './resolve-company-currency';

export interface CreateProjectDto {
  clientId: string;
  name: string;
  description?: string;
  /** MAJOR units (e.g. 75 for "75.00 €") — see `withRate`'s own comment on why the API never speaks
   *  minor units for this column, the same boundary articles.service.ts draws for `Article.unitPrice`. */
  hourlyRate?: number | null;
}

export interface EditProjectDto {
  name?: string;
  description?: string | null;
  hourlyRate?: number | null;
  isArchived?: boolean;
}

export interface ProjectClientSummary {
  id: string;
  name: string;
}

const CLIENT_SELECT = { id: true, name: true } as const;

/** A Project as this module hands it back — `hourlyRate` in MAJOR units, never the stored
 *  minor-unit column a caller has no business seeing directly, plus the owning client's own name so
 *  a project list never needs a second round trip per row (the same reason TimeEntry embeds its own
 *  project summary — see time-entries.service.ts's own `TimeEntryProjectSummary`). */
export type ProjectWithRate = Omit<Project, 'hourlyRateMinor'> & {
  hourlyRate: number | null;
  client: ProjectClientSummary;
};

type RawProject = Project & { client: ProjectClientSummary };

/** The one place `hourlyRateMinor` gets converted back to a caller-facing `hourlyRate` — every
 *  method below that hands a Project back goes through this, so the conversion never drifts between
 *  call sites (the same discipline articles.service.ts's own `withStockFlag` holds for `isLowStock`). */
function withRate(project: RawProject, currency: string): ProjectWithRate {
  const { hourlyRateMinor, ...rest } = project;
  return { ...rest, hourlyRate: hourlyRateMinor !== null ? fromMinor(hourlyRateMinor, currency) : null };
}

/**
 * Time tracking & project invoicing — the layer between Client and TimeEntry. See this file's own
 * schema.prisma comment (Project model) for WHY a project layer exists at all rather than either of
 * the two cheaper shapes: entries straight on Client (an agency running two concurrent engagements
 * for the SAME client could never separate their hours) or entries hanging off an existing quote (the
 * richest option, but it forces a quote to exist before any time can be logged against it — many
 * engagements bill hourly with no quote at all). A project costs exactly one more screen and one more
 * Prisma model; the two alternatives would have cost either a real product gap (client-level) or
 * coupling time-tracking's own existence to the quote/document lifecycle (quote-level) — see
 * time-entries.service.ts's own header for the entry side of this same decision.
 */
@Injectable()
export class ProjectsService {
  async create(companyId: string, dto: CreateProjectDto): Promise<ProjectWithRate> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('A project needs a name.');
    }
    const client = await prisma.client.findFirst({ where: { id: dto.clientId, companyId } });
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    const currency = await resolveCompanyCurrency(companyId);

    const project = await prisma.project.create({
      data: {
        companyId,
        clientId: dto.clientId,
        name: dto.name.trim(),
        description: dto.description ?? null,
        hourlyRateMinor: dto.hourlyRate != null ? toMinor(dto.hourlyRate, currency) : null,
      },
      include: { client: { select: CLIENT_SELECT } },
    });

    logger.info('Project created', {
      category: 'time-tracking',
      details: { projectId: project.id, companyId },
    });
    return withRate(project, currency);
  }

  async findAll(
    companyId: string,
    opts: { clientId?: string; includeArchived?: boolean } = {},
  ): Promise<ProjectWithRate[]> {
    const currency = await resolveCompanyCurrency(companyId);
    const projects = await prisma.project.findMany({
      where: {
        companyId,
        ...(opts.clientId ? { clientId: opts.clientId } : {}),
        ...(opts.includeArchived ? {} : { isArchived: false }),
      },
      include: { client: { select: CLIENT_SELECT } },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map((project) => withRate(project, currency));
  }

  async findOne(companyId: string, id: string): Promise<ProjectWithRate | null> {
    const project = await prisma.project.findFirst({
      where: { id, companyId },
      include: { client: { select: CLIENT_SELECT } },
    });
    if (!project) return null;
    const currency = await resolveCompanyCurrency(companyId);
    return withRate(project, currency);
  }

  async update(companyId: string, id: string, dto: EditProjectDto): Promise<ProjectWithRate> {
    const existing = await prisma.project.findFirst({ where: { id, companyId } });
    if (!existing) {
      throw new NotFoundException('Project not found');
    }
    const currency = await resolveCompanyCurrency(companyId);

    const updated = await prisma.project.update({
      where: { id },
      data: {
        name: dto.name?.trim() || existing.name,
        description: dto.description !== undefined ? dto.description : existing.description,
        // `!== undefined` (never `??`), same convention articles.service.ts's own `update` holds for
        // `quantity`/`lowStockThreshold`: it is what lets a caller explicitly send `null` to clear the
        // default rate rather than that being indistinguishable from "field omitted, keep the current one".
        hourlyRateMinor:
          dto.hourlyRate !== undefined
            ? dto.hourlyRate !== null
              ? toMinor(dto.hourlyRate, currency)
              : null
            : existing.hourlyRateMinor,
        isArchived: dto.isArchived ?? existing.isArchived,
      },
      include: { client: { select: CLIENT_SELECT } },
    });

    logger.info('Project updated', { category: 'time-tracking', details: { projectId: id, companyId } });
    return withRate(updated, currency);
  }
}
