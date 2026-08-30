import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DocumentFieldDescriptor, DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import * as persistence from '../persistence';
import { listSourceRows, validateRowSelections } from './resolve-row-selection';
import { ROW_ID_KEY } from './row-selection';

jest.mock('../persistence');

/**
 * Exercises the REAL `validateRowSelections`/`listSourceRows` — nothing about the decision logic
 * itself is mocked, only the persistence boundary (`findOwnedDocument`), exactly the discipline
 * documents.service.credit-note.spec.ts and references/document-reference.provider.spec.ts already
 * hold `jest.mock('../persistence')` to. This is deliberate: a test that instead mocked
 * `validateRowSelections`/`listSourceRows` themselves would prove nothing about whether the row-still-
 * exists check actually runs — the exact false-green shape this repo has already found once (a mocked
 * test standing in for the very code it claimed to verify).
 */
function invoiceDocument(id: string, lines: Record<string, unknown>[]) {
  return {
    id,
    typeId: 'invoice',
    status: 'draft',
    data: { lines },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function line(rowId: string, description: string): Record<string, unknown> {
  return { [ROW_ID_KEY]: rowId, description, quantity: 1, unitPrice: 10 };
}

const lineFields: DocumentFieldDescriptor[] = [
  { key: 'description', kind: 'text', label: 'Designation', required: true },
  { key: 'quantity', kind: 'number', label: 'Quantity', required: true },
  { key: 'unitPrice', kind: 'money', label: 'Unit price', required: true },
];

const invoiceType: DocumentTypeDescriptor = {
  id: 'invoice',
  label: 'Invoice',
  fields: [
    { key: 'client', kind: 'reference', label: 'Client', entity: 'client' },
    { key: 'lines', kind: 'array', label: 'Lines', fields: lineFields },
  ],
  actions: [],
};

const creditNoteType: DocumentTypeDescriptor = {
  id: 'credit-note',
  label: 'Credit note',
  fields: [
    { key: 'invoice', kind: 'reference', label: 'Invoice', required: true, entity: 'invoice' },
    {
      key: 'correctedLines',
      kind: 'rowSelection',
      label: 'Corrected lines',
      required: true,
      min: 1,
      sourceField: 'invoice',
      sourceEntity: 'invoice',
      sourceArrayField: 'lines',
    },
  ],
  actions: [],
};

function buildRegistry(...types: DocumentTypeDescriptor[]): DocumentTypeRegistry {
  const registry = new DocumentTypeRegistry();
  for (const type of types) registry.register(type);
  return registry;
}

describe('validateRowSelections — the async, cross-document half', () => {
  afterEach(() => jest.resetAllMocks());

  it('accepts a selection of rows that genuinely exist on the referenced source', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      invoiceDocument('invoice-1', [line('r1', 'Widget'), line('r2', 'Gadget')]),
    );

    const errors = await validateRowSelections({
      companyId: 'company-1',
      descriptor: creditNoteType,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      data: { invoice: 'invoice-1', correctedLines: ['r1'] },
    });

    expect(errors).toEqual([]);
  });

  // THE mutation-resistant case: the exact same selection value ('ghost') is checked against two
  // different states of the same source — once where the row is present, once where it is not. A
  // permissive implementation that always returns [] (or that stopped comparing against the source's
  // CURRENT rows) would pass the first call and WRONGLY also pass the second — this is what makes the
  // assertion below fail the moment that regression is introduced, rather than merely "some error
  // fires somewhere".
  it('a selected row that genuinely exists passes; the SAME id blocks once it is gone from the source', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValueOnce(
      invoiceDocument('invoice-1', [line('r1', 'Widget')]),
    );
    const whileItExists = await validateRowSelections({
      companyId: 'company-1',
      descriptor: creditNoteType,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      data: { invoice: 'invoice-1', correctedLines: ['r1'] },
    });
    expect(whileItExists).toEqual([]);

    // Same document id, same selected id — but the source no longer HAS that row (removed, or the
    // invoice was edited down to a different line). Nothing about the request changed except the
    // source's own current state.
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValueOnce(
      invoiceDocument('invoice-1', [line('r2', 'Something else entirely')]),
    );
    const onceItIsGone = await validateRowSelections({
      companyId: 'company-1',
      descriptor: creditNoteType,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      data: { invoice: 'invoice-1', correctedLines: ['r1'] },
    });

    expect(onceItIsGone).not.toEqual([]);
    expect(onceItIsGone).toEqual([
      expect.objectContaining({
        key: 'correctedLines[0]',
        message: expect.stringContaining('r1'),
      }),
    ]);
  });

  it('names exactly the missing row, and only that one, when a selection mixes valid and invalid ids', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      invoiceDocument('invoice-1', [line('r1', 'Widget')]),
    );

    const errors = await validateRowSelections({
      companyId: 'company-1',
      descriptor: creditNoteType,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      data: { invoice: 'invoice-1', correctedLines: ['r1', 'ghost'] },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(
      expect.objectContaining({ key: 'correctedLines[1]', message: expect.stringContaining('ghost') }),
    );
  });

  it('blocks with a clear message when the reference has not been set yet', async () => {
    const errors = await validateRowSelections({
      companyId: 'company-1',
      descriptor: creditNoteType,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      data: { correctedLines: ['r1'] },
    });

    expect(errors).toEqual([
      expect.objectContaining({ key: 'correctedLines', message: expect.stringMatching(/needs "Invoice"/) }),
    ]);
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
  });

  it('blocks with a clear message when the referenced document no longer exists', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(new NotFoundException('gone'));

    const errors = await validateRowSelections({
      companyId: 'company-1',
      descriptor: creditNoteType,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      data: { invoice: 'invoice-1', correctedLines: ['r1'] },
    });

    expect(errors).toEqual([
      expect.objectContaining({ key: 'correctedLines', message: expect.stringMatching(/no longer exists/) }),
    ]);
  });

  it('re-throws an unrelated persistence error instead of turning it into a validation message', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(new Error('db is down'));

    await expect(
      validateRowSelections({
        companyId: 'company-1',
        descriptor: creditNoteType,
        typeRegistry: buildRegistry(invoiceType, creditNoteType),
        data: { invoice: 'invoice-1', correctedLines: ['r1'] },
      }),
    ).rejects.toThrow('db is down');
  });

  it('blocks when "sourceArrayField" names a field that is not repeatable — a config bug, named', async () => {
    const misconfigured: DocumentTypeDescriptor = {
      ...creditNoteType,
      fields: creditNoteType.fields.map((f) =>
        f.key === 'correctedLines' ? { ...f, sourceArrayField: 'client' } : f,
      ),
    };
    // 'client' exists on the invoice type but is a 'reference', not an 'array'.
    const errors = await validateRowSelections({
      companyId: 'company-1',
      descriptor: misconfigured,
      typeRegistry: buildRegistry(invoiceType, misconfigured),
      data: { invoice: 'invoice-1', correctedLines: ['r1'] },
    });

    expect(errors).toEqual([
      expect.objectContaining({
        key: 'correctedLines',
        message: expect.stringMatching(/not a repeatable field/),
      }),
    ]);
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
  });

  it('blocks when "sourceEntity" is not a registered document type', async () => {
    const misconfigured: DocumentTypeDescriptor = {
      ...creditNoteType,
      fields: [
        { key: 'invoice', kind: 'reference', label: 'Invoice', entities: ['invoice', 'quote'] },
        {
          key: 'correctedLines',
          kind: 'rowSelection',
          label: 'Corrected lines',
          sourceField: 'invoice',
          sourceEntity: 'quote', // declared as a possible target of "invoice", but never registered
          sourceArrayField: 'lines',
        },
      ],
    };

    const errors = await validateRowSelections({
      companyId: 'company-1',
      descriptor: misconfigured,
      typeRegistry: buildRegistry(invoiceType), // 'quote' deliberately absent
      data: { invoice: { entity: 'quote', id: 'q1' }, correctedLines: ['r1'] },
    });

    expect(errors).toEqual([
      expect.objectContaining({
        key: 'correctedLines',
        message: expect.stringMatching(/not a registered document type/),
      }),
    ]);
  });

  it('blocks when the MULTI-TARGET sourceField currently points at a different entity than declared', async () => {
    const multiTarget: DocumentTypeDescriptor = {
      id: 'credit-note',
      label: 'Credit note',
      fields: [
        { key: 'invoice', kind: 'reference', label: 'Invoice', entities: ['invoice', 'quote'] },
        {
          key: 'correctedLines',
          kind: 'rowSelection',
          label: 'Corrected lines',
          sourceField: 'invoice',
          sourceEntity: 'invoice',
          sourceArrayField: 'lines',
        },
      ],
      actions: [],
    };
    const quoteType: DocumentTypeDescriptor = { ...invoiceType, id: 'quote', label: 'Quote' };

    const errors = await validateRowSelections({
      companyId: 'company-1',
      descriptor: multiTarget,
      typeRegistry: buildRegistry(invoiceType, quoteType, multiTarget),
      // The reference currently names a QUOTE, but this field only ever selects from an INVOICE.
      data: { invoice: { entity: 'quote', id: 'q1' }, correctedLines: ['r1'] },
    });

    expect(errors).toEqual([
      expect.objectContaining({
        key: 'correctedLines',
        message: expect.stringMatching(/expects "Invoice" to reference a "invoice".*references a "quote"/),
      }),
    ]);
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
  });

  it('does not double-report a value that already failed the structural (shape) check', async () => {
    const errors = await validateRowSelections({
      companyId: 'company-1',
      descriptor: creditNoteType,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      data: { invoice: 'invoice-1', correctedLines: 'not-a-list' },
    });

    expect(errors).toEqual([]);
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
  });

  it("is a no-op for a descriptor with no 'rowSelection' field at all", async () => {
    const errors = await validateRowSelections({
      companyId: 'company-1',
      descriptor: invoiceType,
      typeRegistry: buildRegistry(invoiceType),
      data: { client: 'client-1', lines: [] },
    });

    expect(errors).toEqual([]);
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
  });
});

describe('listSourceRows — what a picker may currently offer', () => {
  afterEach(() => jest.resetAllMocks());

  const correctedLinesField = creditNoteType.fields.find(
    (f) => f.key === 'correctedLines',
  ) as DocumentFieldDescriptor;

  it('lists every stamped row of the referenced source, stripping the internal id key from its data', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      invoiceDocument('invoice-1', [line('r1', 'Widget')]),
    );

    const result = await listSourceRows({
      companyId: 'company-1',
      descriptor: creditNoteType,
      field: correctedLinesField,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      sourceId: 'invoice-1',
    });

    expect(result).toEqual({
      sourceTypeId: 'invoice',
      sourceArrayField: 'lines',
      rows: [{ id: 'r1', data: { description: 'Widget', quantity: 1, unitPrice: 10 } }],
    });
  });

  it('excludes a row nobody has stamped an id onto yet — never a fabricated stand-in id', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      invoiceDocument('invoice-1', [{ description: 'Legacy, unsaved-since-this-kind-existed' }]),
    );

    const result = await listSourceRows({
      companyId: 'company-1',
      descriptor: creditNoteType,
      field: correctedLinesField,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      sourceId: 'invoice-1',
    });

    expect(result.rows).toEqual([]);
  });

  it('degrades to an empty list, not an error, when no source has been picked yet', async () => {
    const result = await listSourceRows({
      companyId: 'company-1',
      descriptor: creditNoteType,
      field: correctedLinesField,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      sourceId: undefined,
    });

    expect(result).toEqual({ sourceTypeId: 'invoice', sourceArrayField: 'lines', rows: [] });
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
  });

  it('degrades to an empty list when the referenced document does not exist (or is not owned)', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(new NotFoundException('gone'));

    const result = await listSourceRows({
      companyId: 'company-1',
      descriptor: creditNoteType,
      field: correctedLinesField,
      typeRegistry: buildRegistry(invoiceType, creditNoteType),
      sourceId: 'nope',
    });

    expect(result.rows).toEqual([]);
  });

  it('throws BadRequestException for a field that is not a "rowSelection" field at all', async () => {
    const notionalField = creditNoteType.fields.find((f) => f.key === 'invoice') as DocumentFieldDescriptor;

    await expect(
      listSourceRows({
        companyId: 'company-1',
        descriptor: creditNoteType,
        field: notionalField,
        typeRegistry: buildRegistry(invoiceType, creditNoteType),
        sourceId: 'invoice-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException for a misconfigured "rowSelection" field, naming the problem', async () => {
    const misconfigured: DocumentFieldDescriptor = { ...correctedLinesField, sourceField: undefined };

    await expect(
      listSourceRows({
        companyId: 'company-1',
        descriptor: creditNoteType,
        field: misconfigured,
        typeRegistry: buildRegistry(invoiceType, creditNoteType),
        sourceId: 'invoice-1',
      }),
    ).rejects.toThrow(/sourceField/);
  });
});
