import { listDocumentTypesTool } from './list-document-types.tool';
import { ToolContext } from './types';

describe('listDocumentTypesTool', () => {
  function buildContext(
    listAvailableTypes: jest.Mock,
    describeTypeForCompany: jest.Mock,
    scopes: string[] | null = ['quotes:read', 'invoices:read'],
  ): ToolContext {
    return {
      companyId: 'company1',
      scopes,
      baseUrl: 'http://localhost:4000',
      services: {
        documentsService: { listAvailableTypes, describeTypeForCompany } as any,
        shareLinksService: {} as any,
        clientsService: {} as any,
        articlesService: {} as any,
      },
    };
  }

  it('describes every type the country makes available AND this key holds a scope for', async () => {
    const listAvailableTypes = jest.fn().mockResolvedValue({
      types: [
        { id: 'quote', label: 'Quote' },
        { id: 'invoice', label: 'Invoice' },
      ],
    });
    const describeTypeForCompany = jest.fn(async (_companyId: string, typeId: string) => ({
      id: typeId,
      label: typeId,
      fields: [],
      actions: [{ id: 'save-draft', label: 'Save draft', availableWhen: 'always' }],
    }));
    const ctx = buildContext(listAvailableTypes, describeTypeForCompany);

    const result = await listDocumentTypesTool.handler(ctx, {});

    expect(listAvailableTypes).toHaveBeenCalledWith('company1');
    expect(describeTypeForCompany).toHaveBeenCalledWith('company1', 'quote');
    expect(describeTypeForCompany).toHaveBeenCalledWith('company1', 'invoice');
    expect((result.structuredContent as any).types.map((t: any) => t.id)).toEqual(['quote', 'invoice']);
  });

  it("never describes a type this key holds no scope for — even one the company's country allows", async () => {
    const listAvailableTypes = jest.fn().mockResolvedValue({
      types: [
        { id: 'quote', label: 'Quote' },
        { id: 'invoice', label: 'Invoice' },
      ],
    });
    const describeTypeForCompany = jest.fn(async (_companyId: string, typeId: string) => ({
      id: typeId,
      label: typeId,
      fields: [],
      actions: [],
    }));
    const ctx = buildContext(listAvailableTypes, describeTypeForCompany, ['quotes:read']); // no invoices:*

    const result = await listDocumentTypesTool.handler(ctx, {});

    expect(describeTypeForCompany).toHaveBeenCalledTimes(1);
    expect(describeTypeForCompany).toHaveBeenCalledWith('company1', 'quote');
    expect((result.structuredContent as any).types.map((t: any) => t.id)).toEqual(['quote']);
  });

  it('carries the reason through when the country has no types available at all', async () => {
    const listAvailableTypes = jest.fn().mockResolvedValue({ types: [], reason: 'No policy for "ZZ".' });
    const describeTypeForCompany = jest.fn();
    const ctx = buildContext(listAvailableTypes, describeTypeForCompany);

    const result = await listDocumentTypesTool.handler(ctx, {});

    expect(describeTypeForCompany).not.toHaveBeenCalled();
    expect(result.structuredContent).toEqual({ types: [], reason: 'No policy for "ZZ".' });
  });
});
