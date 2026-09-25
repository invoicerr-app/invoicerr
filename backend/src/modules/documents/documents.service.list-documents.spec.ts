import { vi, type Mock } from 'vitest';

import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { ContributionRegistry } from './contributions/contribution-registry';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { DocumentTypeDescriptor } from './descriptors/types';
import { ParsedListDocumentsQuery } from './dto/list-documents.dto';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as unsettledInvoices from './settlement/unsettled-invoices';
import { TransportRegistry } from './transports/transport-registry';

vi.mock('./settlement/unsettled-invoices');

/**
 * Proves `DocumentsService.listDocuments` — the descriptor-resolution half of `GET /documents`'s
 * filters (which field a "client" or a date range even means, for THIS type) — the same "mock the
 * Prisma boundary only" discipline `documents.service.numbering.spec.ts` already holds for the
 * sibling wiring concern. `persistence.listDocumentsPage`'s OWN behavior (pagination math, the
 * in-memory date path, the search OR clause it builds) is proven directly against a mocked Prisma in
 * `persistence.spec.ts`; this file only proves that THIS service resolves the right descriptor facts
 * and refuses the right things before ever calling it.
 */
vi.mock('./persistence');
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { client: { findMany: vi.fn() } },
}));

/** Shaped like the real `invoice`/`quote` descriptors: a `client` reference field (titleField) and
 *  an `issueDate`. */
const INVOICE_LIKE_DESCRIPTOR: DocumentTypeDescriptor = {
  id: 'invoice',
  label: 'Invoice',
  fields: [
    { key: 'client', kind: 'reference', label: 'Client', required: true, entity: 'client' },
    { key: 'issueDate', kind: 'date', label: 'Date', required: true },
  ],
  listItem: { titleFields: ['client'] },
  actions: [],
};

/** Shaped like the real `expense` descriptor: no relation field at all, a plain text `description`
 *  titleField and a `date` (not `issueDate`). */
const EXPENSE_LIKE_DESCRIPTOR: DocumentTypeDescriptor = {
  id: 'expense',
  label: 'Expense',
  fields: [
    { key: 'description', kind: 'text', label: 'Description', required: true },
    { key: 'date', kind: 'date', label: 'Date', required: true },
  ],
  listItem: { titleFields: ['description'] },
  actions: [],
};

/** No client field, no date field at all — e.g. a plugin type built around something else entirely. */
const DATELESS_DESCRIPTOR: DocumentTypeDescriptor = {
  id: 'widget',
  label: 'Widget',
  fields: [{ key: 'name', kind: 'text', label: 'Name', required: true }],
  listItem: { titleFields: ['name'] },
  actions: [],
};

function buildService(...descriptors: DocumentTypeDescriptor[]): DocumentsService {
  const typeRegistry = new DocumentTypeRegistry();
  for (const descriptor of descriptors) typeRegistry.register(descriptor);

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  return new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );
}

const DEFAULT_QUERY: ParsedListDocumentsQuery = {
  page: 1,
  pageSize: 25,
  sort: 'updatedAt',
  order: 'desc',
};

const EMPTY_PAGE = { items: [], total: 0, page: 1, pageSize: 25 };

describe('DocumentsService.listDocuments', () => {
  beforeEach(() => {
    (persistence.listDocumentsPage as Mock).mockResolvedValue(EMPTY_PAGE);
  });
  afterEach(() => vi.resetAllMocks());

  it('refuses clientId/dateFrom/dateTo/q without a typeId — none of them mean anything without one type’s own descriptor', async () => {
    const service = buildService(INVOICE_LIKE_DESCRIPTOR);
    await expect(
      service.listDocuments('company-1', undefined, { ...DEFAULT_QUERY, q: 'acme' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.listDocuments('company-1', undefined, { ...DEFAULT_QUERY, clientId: 'client-1' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.listDocuments('company-1', undefined, { ...DEFAULT_QUERY, dateFrom: '2026-01-01' }),
    ).rejects.toThrow(BadRequestException);
    expect(persistence.listDocumentsPage).not.toHaveBeenCalled();
  });

  it('lists across every type (no typeId) fine as long as only status/page/sort are asked for', async () => {
    const service = buildService(INVOICE_LIKE_DESCRIPTOR, EXPENSE_LIKE_DESCRIPTOR);
    await service.listDocuments('company-1', undefined, { ...DEFAULT_QUERY, status: ['draft'] });

    expect(persistence.listDocumentsPage).toHaveBeenCalledWith('company-1', {
      typeId: undefined,
      page: 1,
      pageSize: 25,
      status: ['draft'],
      sort: 'updatedAt',
      order: 'desc',
      clientFieldKey: undefined,
      clientId: undefined,
      dateFieldKey: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      q: undefined,
      searchTextFieldKeys: [],
      searchClientIds: undefined,
    });
  });

  it('scopes by the given companyId, unchanged, next to whatever typeId names', async () => {
    const service = buildService(INVOICE_LIKE_DESCRIPTOR);
    await service.listDocuments('company-acme', 'invoice', DEFAULT_QUERY);
    await service.listDocuments('company-other', 'invoice', DEFAULT_QUERY);

    expect(persistence.listDocumentsPage).toHaveBeenNthCalledWith(1, 'company-acme', expect.anything());
    expect(persistence.listDocumentsPage).toHaveBeenNthCalledWith(2, 'company-other', expect.anything());
  });

  it('refuses clientId on a type with no client-reference field (expense has none)', async () => {
    const service = buildService(EXPENSE_LIKE_DESCRIPTOR);
    await expect(
      service.listDocuments('company-1', 'expense', { ...DEFAULT_QUERY, clientId: 'client-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(persistence.listDocumentsPage).not.toHaveBeenCalled();
  });

  it('refuses dateFrom/dateTo on a type with no date field at all', async () => {
    const service = buildService(DATELESS_DESCRIPTOR);
    await expect(
      service.listDocuments('company-1', 'widget', { ...DEFAULT_QUERY, dateFrom: '2026-01-01' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.listDocuments('company-1', 'widget', { ...DEFAULT_QUERY, dateTo: '2026-01-31' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('resolves the client field key and passes clientId straight through, for a client-bearing type', async () => {
    const service = buildService(INVOICE_LIKE_DESCRIPTOR);
    await service.listDocuments('company-1', 'invoice', { ...DEFAULT_QUERY, clientId: 'client-1' });

    expect(persistence.listDocumentsPage).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ typeId: 'invoice', clientFieldKey: 'client', clientId: 'client-1' }),
    );
  });

  it('resolves "issueDate" as the date field for an invoice-shaped type, "date" for an expense-shaped one', async () => {
    const invoiceService = buildService(INVOICE_LIKE_DESCRIPTOR);
    await invoiceService.listDocuments('company-1', 'invoice', {
      ...DEFAULT_QUERY,
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    });
    expect(persistence.listDocumentsPage).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ dateFieldKey: 'issueDate', dateFrom: '2026-01-01', dateTo: '2026-01-31' }),
    );

    vi.clearAllMocks();
    (persistence.listDocumentsPage as Mock).mockResolvedValue(EMPTY_PAGE);
    const expenseService = buildService(EXPENSE_LIKE_DESCRIPTOR);
    await expenseService.listDocuments('company-1', 'expense', { ...DEFAULT_QUERY, dateFrom: '2026-01-01' });
    expect(persistence.listDocumentsPage).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ dateFieldKey: 'date' }),
    );
  });

  it('combines status + clientId + dateFrom/dateTo + q all at once, resolving every filter together', async () => {
    (prisma.client.findMany as Mock).mockResolvedValue([{ id: 'client-9' }]);
    const service = buildService(INVOICE_LIKE_DESCRIPTOR);

    await service.listDocuments('company-1', 'invoice', {
      page: 2,
      pageSize: 10,
      sort: 'createdAt',
      order: 'asc',
      status: ['draft', 'sent'],
      clientId: 'client-1',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      q: 'acme',
    });

    expect(persistence.listDocumentsPage).toHaveBeenCalledWith('company-1', {
      typeId: 'invoice',
      page: 2,
      pageSize: 10,
      status: ['draft', 'sent'],
      sort: 'createdAt',
      order: 'asc',
      clientFieldKey: 'client',
      clientId: 'client-1',
      dateFieldKey: 'issueDate',
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      q: 'acme',
      searchTextFieldKeys: [],
      searchClientIds: ['client-9'],
    });
  });

  it('searches client NAMES (company-scoped, capped) when q is given on a client-bearing type', async () => {
    (prisma.client.findMany as Mock).mockResolvedValue([{ id: 'client-9' }, { id: 'client-10' }]);
    const service = buildService(INVOICE_LIKE_DESCRIPTOR);

    await service.listDocuments('company-1', 'invoice', { ...DEFAULT_QUERY, q: 'acme' });

    expect(prisma.client.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', name: { contains: 'acme', mode: 'insensitive' } },
      select: { id: true },
      take: 50,
    });
    expect(persistence.listDocumentsPage).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ q: 'acme', searchClientIds: ['client-9', 'client-10'] }),
    );
  });

  it('never queries Client at all when the type has no client field — q only does free-text title matching', async () => {
    const service = buildService(EXPENSE_LIKE_DESCRIPTOR);
    await service.listDocuments('company-1', 'expense', { ...DEFAULT_QUERY, q: 'taxi' });

    expect(prisma.client.findMany).not.toHaveBeenCalled();
    expect(persistence.listDocumentsPage).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        q: 'taxi',
        searchTextFieldKeys: ['description'],
        searchClientIds: undefined,
      }),
    );
  });

  it('returns exactly what persistence.listDocumentsPage resolves to, unmodified', async () => {
    const page = { items: [{ id: 'doc-1' }], total: 1, page: 1, pageSize: 25 };
    (persistence.listDocumentsPage as Mock).mockResolvedValue(page);
    const service = buildService(INVOICE_LIKE_DESCRIPTOR);

    await expect(service.listDocuments('company-1', 'invoice', DEFAULT_QUERY)).resolves.toEqual(page);
  });

  it('404s for an unknown typeId, exactly like every other per-type read on this service', async () => {
    const service = buildService(INVOICE_LIKE_DESCRIPTOR);
    await expect(service.listDocuments('company-1', 'nope', DEFAULT_QUERY)).rejects.toThrow(
      'Unknown document type "nope".',
    );
  });

  /**
   * `settlement` is checked and applied entirely inside this service: the SHAPE check (is it
   * "unsettled"/"overdue" at all) already lives in `dto/list-documents.dto.spec.ts`. What belongs
   * here is the "only valid with typeId=invoice" restriction, and that the resolved id set is handed
   * straight to `persistence.listDocumentsPage` as `ids`, the mechanism `settlement/unsettled-invoices.ts`
   * (mocked here) shares with invoice-contributions.ts's own dashboard tiles.
   */
  describe('settlement filter', () => {
    it('refuses settlement without a typeId at all', async () => {
      const service = buildService(INVOICE_LIKE_DESCRIPTOR);
      await expect(
        service.listDocuments('company-1', undefined, { ...DEFAULT_QUERY, settlement: 'unsettled' }),
      ).rejects.toThrow(BadRequestException);
      expect(persistence.listDocumentsPage).not.toHaveBeenCalled();
    });

    it('refuses settlement on a typeId other than "invoice"', async () => {
      const service = buildService(EXPENSE_LIKE_DESCRIPTOR);
      await expect(
        service.listDocuments('company-1', 'expense', { ...DEFAULT_QUERY, settlement: 'unsettled' }),
      ).rejects.toThrow(BadRequestException);
      expect(persistence.listDocumentsPage).not.toHaveBeenCalled();
    });

    it('resolves "unsettled" through filterUnsettledInvoices and restricts the list to those ids', async () => {
      const service = buildService(INVOICE_LIKE_DESCRIPTOR);
      const invoices = [{ id: 'inv-1' }, { id: 'inv-2' }];
      (persistence.listAllDocuments as Mock).mockResolvedValue(invoices);
      (unsettledInvoices.filterUnsettledInvoices as Mock).mockResolvedValue([
        { id: 'inv-1', data: { dueDate: '2099-01-01' } },
      ]);

      await service.listDocuments('company-1', 'invoice', { ...DEFAULT_QUERY, settlement: 'unsettled' });

      expect(persistence.listAllDocuments).toHaveBeenCalledWith('company-1', { typeId: 'invoice' });
      expect(unsettledInvoices.filterUnsettledInvoices).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({ id: 'invoice' }),
        invoices,
      );
      expect(persistence.listDocumentsPage).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({ ids: ['inv-1'] }),
      );
    });

    it('narrows "overdue" further, to only the unsettled invoices isOverdueInvoice also accepts', async () => {
      const service = buildService(INVOICE_LIKE_DESCRIPTOR);
      const notOverdue = { id: 'inv-not-overdue', data: {} };
      const overdue = { id: 'inv-overdue', data: { dueDate: '2020-01-01' } };
      (persistence.listAllDocuments as Mock).mockResolvedValue([notOverdue, overdue]);
      (unsettledInvoices.filterUnsettledInvoices as Mock).mockResolvedValue([notOverdue, overdue]);
      (unsettledInvoices.isOverdueInvoice as Mock).mockImplementation(
        (invoice: { id: string }) => invoice.id === 'inv-overdue',
      );

      await service.listDocuments('company-1', 'invoice', { ...DEFAULT_QUERY, settlement: 'overdue' });

      expect(persistence.listDocumentsPage).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({ ids: ['inv-overdue'] }),
      );
    });
  });
});
