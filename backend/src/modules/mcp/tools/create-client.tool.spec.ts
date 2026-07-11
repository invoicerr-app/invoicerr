import { createClientTool } from './create-client.tool';
import { ToolContext } from './types';

describe('createClientTool', () => {
  function buildContext(createClient: jest.Mock): ToolContext {
    return {
      companyId: 'company1',
      scopes: ['clients:write'],
      services: {
        clientsService: { createClient } as any,
        quotesService: {} as any,
        invoicesService: {} as any,
        articlesService: {} as any,
        pdfLinksService: {} as any,
      },
    };
  }

  it('creates the client as active regardless of input, scoped to the active company', async () => {
    const createClient = jest.fn().mockResolvedValue({ id: 'c1', name: 'Acme' });
    const ctx = buildContext(createClient);

    await createClientTool.handler(ctx, {
      name: 'Acme',
      address: '1 rue Test',
      postalCode: '75001',
      city: 'Paris',
      country: 'France',
      currency: 'EUR' as any,
    });

    expect(createClient).toHaveBeenCalledWith(
      'company1',
      expect.objectContaining({
        name: 'Acme',
        isActive: true,
      }),
    );
  });

  it('returns the created client id and name as structured content', async () => {
    const createClient = jest.fn().mockResolvedValue({ id: 'c1', name: 'Acme' });
    const ctx = buildContext(createClient);

    const result = await createClientTool.handler(ctx, {
      name: 'Acme',
      address: '1 rue Test',
      postalCode: '75001',
      city: 'Paris',
      country: 'France',
      currency: 'EUR' as any,
    });

    expect(result.structuredContent).toEqual({ id: 'c1', name: 'Acme' });
  });
});
