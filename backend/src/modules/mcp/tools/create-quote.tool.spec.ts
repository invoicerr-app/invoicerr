import { createQuoteTool } from './create-quote.tool';
import { ToolContext } from './types';

describe('createQuoteTool', () => {
    function buildContext(overrides: Partial<ToolContext['services']> = {}): ToolContext {
        return {
            companyId: 'company1',
            scopes: ['quotes:write'],
            services: {
                quotesService: { createQuote: jest.fn() } as any,
                invoicesService: {} as any,
                clientsService: {} as any,
                articlesService: {} as any,
                pdfLinksService: {} as any,
                ...overrides,
            },
        };
    }

    it('calls quotesService.createQuote with the active companyId and mapped input', async () => {
        const createQuote = jest.fn().mockResolvedValue({ id: 'q1', number: 12, rawNumber: 'Q-2026-0012' });
        const ctx = buildContext({ quotesService: { createQuote } as any });

        await createQuoteTool.handler(ctx, {
            clientId: 'client1',
            notes: 'hello',
            validUntil: '2026-08-01T00:00:00.000Z',
            items: [{ name: 'Service', quantity: 1, unitPrice: 100, vatRate: 20, type: 'SERVICE' as any, order: 0 }],
        });

        expect(createQuote).toHaveBeenCalledWith('company1', expect.objectContaining({
            clientId: 'client1',
            notes: 'hello',
            validUntil: new Date('2026-08-01T00:00:00.000Z'),
        }));
    });

    it('returns the created quote id as structured content', async () => {
        const createQuote = jest.fn().mockResolvedValue({ id: 'q1', number: 12, rawNumber: 'Q-2026-0012' });
        const ctx = buildContext({ quotesService: { createQuote } as any });

        const result = await createQuoteTool.handler(ctx, {
            clientId: 'client1',
            notes: '',
            items: [{ name: 'Service', quantity: 1, unitPrice: 100, vatRate: 20, type: 'SERVICE' as any, order: 0 }],
        });

        expect(result.structuredContent).toEqual({ id: 'q1', number: 12, rawNumber: 'Q-2026-0012' });
        const [block] = result.content;
        expect(block.type).toBe('text');
        expect((block as { type: 'text'; text: string }).text).toContain('Q-2026-0012');
    });
});
