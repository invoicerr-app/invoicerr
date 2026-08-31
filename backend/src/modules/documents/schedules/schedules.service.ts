/**
 * The CRUD half of recurrences (root TODO item 5) — everything the schedules screen needs
 * (documents.controller.ts's `schedules/*` routes). The RUNTIME half (the sweep, an occurrence's own
 * execution) lives in schedule-sweep-runner.ts; this class never touches the queue at all.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { deriveAnchorDay, isScheduleCadence, toUtcMidnight } from './cadence';
import { CreateDocumentScheduleDto, UpdateDocumentScheduleDto } from './schedule.dto';
import {
  createSchedule,
  deleteSchedule,
  DocumentScheduleRecord,
  listSchedules,
  updateSchedule,
} from './schedule.persistence';
import { DocumentsService } from '../documents.service';

@Injectable()
export class DocumentSchedulesService {
  // `DocumentsService`, not `DocumentTypeRegistry`/`ActionExtensionRegistry` separately: `getType`
  // already hands back the MERGED descriptor (native actions + third-party extensions like
  // "duplicate" — see documents.service.ts's own header on `mergedDescriptor`), which is exactly
  // what validating "does this type/action combination exist at all" needs; `getDocument` is the
  // same tenant-scoped 404 every other document read in this module already goes through. Reusing
  // both means this class never re-implements either check.
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * Validates the (typeId, actionId, sourceDocumentId, cadence) the screen submitted, then persists
   * a schedule whose very first `nextRunAt` IS `firstOccurrenceAt` itself — not "the first occurrence
   * AFTER it". A `firstOccurrenceAt` in the past is accepted deliberately: it becomes due at the very
   * next sweep pass, which is exactly the "create with a first occurrence in the past, watch it fire"
   * scenario 29-document-recurrence.cy.ts drives from the screen.
   */
  async create(companyId: string, input: CreateDocumentScheduleDto): Promise<DocumentScheduleRecord> {
    // 404s for an unknown type, the same way every other entry point into this module does.
    const descriptor = this.documentsService.getType(input.typeId);
    if (!descriptor.actions.some((action) => action.id === input.actionId)) {
      throw new NotFoundException(`Document type "${input.typeId}" has no action "${input.actionId}".`);
    }

    // Tenant-scoped 404 for a source document that doesn't exist, or belongs to another company/type.
    await this.documentsService.getDocument(companyId, input.typeId, input.sourceDocumentId);

    if (!isScheduleCadence(input.cadence)) {
      throw new BadRequestException(
        `Unknown cadence "${input.cadence}" — expected one of "weekly", "monthly", "quarterly", "yearly".`,
      );
    }

    const firstOccurrenceMs = Date.parse(input.firstOccurrenceAt);
    if (Number.isNaN(firstOccurrenceMs)) {
      throw new BadRequestException(`Invalid firstOccurrenceAt "${input.firstOccurrenceAt}".`);
    }
    const nextRunAt = toUtcMidnight(new Date(firstOccurrenceMs));

    return createSchedule({
      companyId,
      typeId: input.typeId,
      sourceDocumentId: input.sourceDocumentId,
      actionId: input.actionId,
      cadence: input.cadence,
      // Weekly has no month to anchor a day within (cadence.ts's own header) — null rather than a
      // meaningless value nothing will ever read.
      anchorDay: input.cadence === 'weekly' ? null : deriveAnchorDay(nextRunAt),
      nextRunAt,
      params: input.thenSend === undefined ? undefined : { thenSend: input.thenSend },
    });
  }

  async list(companyId: string, typeId?: string): Promise<DocumentScheduleRecord[]> {
    return listSchedules(companyId, typeId);
  }

  /** The screen's only two write operations on an EXISTING schedule are enable/disable — see
   *  schedule.persistence.ts's own `updateSchedule` for why cadence/source/action are immutable. */
  async setEnabled(
    companyId: string,
    id: string,
    input: UpdateDocumentScheduleDto,
  ): Promise<DocumentScheduleRecord> {
    return updateSchedule(companyId, id, { enabled: input.enabled });
  }

  async remove(companyId: string, id: string): Promise<{ deleted: true }> {
    await deleteSchedule(companyId, id);
    return { deleted: true };
  }
}
