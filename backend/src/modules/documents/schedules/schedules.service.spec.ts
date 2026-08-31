import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DocumentsService } from '../documents.service';
import { DocumentSchedulesService } from './schedules.service';
import * as schedulePersistence from './schedule.persistence';

jest.mock('./schedule.persistence');

const DESCRIPTOR = {
  id: 'invoice',
  label: 'Invoice',
  fields: [],
  actions: [{ id: 'duplicate', label: 'Duplicate', availableWhen: ['draft', 'sent'] }],
};

function buildDocumentsService(overrides: Partial<DocumentsService> = {}): DocumentsService {
  return {
    getType: jest.fn().mockReturnValue(DESCRIPTOR),
    getDocument: jest.fn().mockResolvedValue({ id: 'doc-1', typeId: 'invoice', status: 'draft' }),
    ...overrides,
  } as unknown as DocumentsService;
}

describe('DocumentSchedulesService.create', () => {
  afterEach(() => jest.resetAllMocks());

  it('persists a schedule whose nextRunAt IS firstOccurrenceAt, UTC-midnight-normalized', async () => {
    const documentsService = buildDocumentsService();
    const service = new DocumentSchedulesService(documentsService);

    await service.create('company-1', {
      typeId: 'invoice',
      sourceDocumentId: 'doc-1',
      actionId: 'duplicate',
      cadence: 'monthly',
      firstOccurrenceAt: '2026-01-31T17:42:00.000Z',
    });

    expect(schedulePersistence.createSchedule).toHaveBeenCalledWith({
      companyId: 'company-1',
      typeId: 'invoice',
      sourceDocumentId: 'doc-1',
      actionId: 'duplicate',
      cadence: 'monthly',
      anchorDay: 31,
      nextRunAt: new Date('2026-01-31T00:00:00.000Z'),
      params: undefined,
    });
  });

  it('leaves anchorDay null for "weekly" — no month to anchor a day within', async () => {
    const service = new DocumentSchedulesService(buildDocumentsService());

    await service.create('company-1', {
      typeId: 'invoice',
      sourceDocumentId: 'doc-1',
      actionId: 'duplicate',
      cadence: 'weekly',
      firstOccurrenceAt: '2026-01-31T00:00:00.000Z',
    });

    expect(schedulePersistence.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ anchorDay: null }),
    );
  });

  it('carries thenSend into params when set, and omits params entirely when it is not', async () => {
    const service = new DocumentSchedulesService(buildDocumentsService());

    await service.create('company-1', {
      typeId: 'invoice',
      sourceDocumentId: 'doc-1',
      actionId: 'duplicate',
      cadence: 'monthly',
      firstOccurrenceAt: '2026-01-31T00:00:00.000Z',
      thenSend: true,
    });

    expect(schedulePersistence.createSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ params: { thenSend: true } }),
    );
  });

  it('404s for an unknown document type (via DocumentsService.getType)', async () => {
    const documentsService = buildDocumentsService({
      getType: jest.fn().mockImplementation(() => {
        throw new NotFoundException('Unknown document type "bogus".');
      }),
    });
    const service = new DocumentSchedulesService(documentsService);

    await expect(
      service.create('company-1', {
        typeId: 'bogus',
        sourceDocumentId: 'doc-1',
        actionId: 'duplicate',
        cadence: 'monthly',
        firstOccurrenceAt: '2026-01-31T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the type does not declare the given actionId at all', async () => {
    const service = new DocumentSchedulesService(buildDocumentsService());

    await expect(
      service.create('company-1', {
        typeId: 'invoice',
        sourceDocumentId: 'doc-1',
        actionId: 'no-such-action',
        cadence: 'monthly',
        firstOccurrenceAt: '2026-01-31T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400s for an unknown cadence — the four closed values only', async () => {
    const service = new DocumentSchedulesService(buildDocumentsService());

    await expect(
      service.create('company-1', {
        typeId: 'invoice',
        sourceDocumentId: 'doc-1',
        actionId: 'duplicate',
        cadence: 'biweekly', // the old, removed RecurringInvoice's own vocabulary — deliberately rejected
        firstOccurrenceAt: '2026-01-31T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s for an unparseable firstOccurrenceAt', async () => {
    const service = new DocumentSchedulesService(buildDocumentsService());

    await expect(
      service.create('company-1', {
        typeId: 'invoice',
        sourceDocumentId: 'doc-1',
        actionId: 'duplicate',
        cadence: 'monthly',
        firstOccurrenceAt: 'not-a-date',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('propagates the tenant-scoped 404 when the source document does not belong to this company', async () => {
    const documentsService = buildDocumentsService({
      getDocument: jest.fn().mockRejectedValue(new NotFoundException('not found')),
    });
    const service = new DocumentSchedulesService(documentsService);

    await expect(
      service.create('company-1', {
        typeId: 'invoice',
        sourceDocumentId: 'someone-elses-doc',
        actionId: 'duplicate',
        cadence: 'monthly',
        firstOccurrenceAt: '2026-01-31T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentSchedulesService — list/setEnabled/remove delegate to schedule.persistence', () => {
  afterEach(() => jest.resetAllMocks());

  it('list', async () => {
    const service = new DocumentSchedulesService(buildDocumentsService());
    await service.list('company-1', 'invoice');
    expect(schedulePersistence.listSchedules).toHaveBeenCalledWith('company-1', 'invoice');
  });

  it('setEnabled', async () => {
    const service = new DocumentSchedulesService(buildDocumentsService());
    await service.setEnabled('company-1', 'sched-1', { enabled: false });
    expect(schedulePersistence.updateSchedule).toHaveBeenCalledWith('company-1', 'sched-1', {
      enabled: false,
    });
  });

  it('remove', async () => {
    const service = new DocumentSchedulesService(buildDocumentsService());
    const result = await service.remove('company-1', 'sched-1');
    expect(schedulePersistence.deleteSchedule).toHaveBeenCalledWith('company-1', 'sched-1');
    expect(result).toEqual({ deleted: true });
  });
});
