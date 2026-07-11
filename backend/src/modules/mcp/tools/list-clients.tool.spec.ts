import { listClientsTool } from './list-clients.tool';
import { ToolContext } from './types';

describe('listClientsTool', () => {
    function buildContext(searchClients: jest.Mock): ToolContext {
        return {
            companyId: 'company1',
            scopes: ['clients:read'],
            services: {
                clientsService: { searchClients } as any,
                quotesService: {} as any,
                invoicesService: {} as any,
                articlesService: {} as any,
                pdfLinksService: {} as any,
            },
        };
    }

    it('calls clientsService.searchClients with the active companyId and an empty query when none is given', async () => {
        const searchClients = jest.fn().mockResolvedValue([]);
        const ctx = buildContext(searchClients);

        await listClientsTool.handler(ctx, {});

        expect(searchClients).toHaveBeenCalledWith('company1', '');
    });

    it('forwards a provided query', async () => {
        const searchClients = jest.fn().mockResolvedValue([]);
        const ctx = buildContext(searchClients);

        await listClientsTool.handler(ctx, { query: 'Acme' });

        expect(searchClients).toHaveBeenCalledWith('company1', 'Acme');
    });

    it('maps clients to a compact disambiguation-friendly summary', async () => {
        const searchClients = jest.fn().mockResolvedValue([
            {
                id: 'c1', name: 'Acme Corp', type: 'COMPANY', legalId: '123',
                contactFirstname: null, contactLastname: null,
                contactEmail: 'a@acme.test', contactPhone: null,
                city: 'Paris', country: 'France',
            },
            {
                id: 'c2', name: '', type: 'INDIVIDUAL', legalId: null,
                contactFirstname: 'Thomas', contactLastname: 'Dupont',
                contactEmail: null, contactPhone: '0102030405',
                city: 'Lyon', country: 'France',
            },
        ]);
        const ctx = buildContext(searchClients);

        const result = await listClientsTool.handler(ctx, { query: 'Th' });

        expect(result.content).toEqual([{ type: 'text', text: '2 client(s) found.' }]);
        expect(result.structuredContent).toEqual({
            clients: [
                { id: 'c1', name: 'Acme Corp', type: 'COMPANY', legalId: '123', contactFirstname: null, contactLastname: null, contactEmail: 'a@acme.test', contactPhone: null, city: 'Paris', country: 'France' },
                { id: 'c2', name: '', type: 'INDIVIDUAL', legalId: null, contactFirstname: 'Thomas', contactLastname: 'Dupont', contactEmail: null, contactPhone: '0102030405', city: 'Lyon', country: 'France' },
            ],
        });
    });
});
