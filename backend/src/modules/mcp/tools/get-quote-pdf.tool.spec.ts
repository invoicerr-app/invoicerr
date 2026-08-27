import { getQuotePdfTool } from './get-quote-pdf.tool';
import { ToolContext } from './types';

describe('getQuotePdfTool', () => {
    function buildContext(getQuotePdf: jest.Mock, createToken: jest.Mock = jest.fn().mockResolvedValue('rawtoken')): ToolContext {
        return {
            companyId: 'company1',
            scopes: ['quotes:read'],
            services: {
                quotesService: { getQuotePdf } as any,
                invoicesService: {} as any,
                clientsService: {} as any,
                articlesService: {} as any,
                pdfLinksService: { createToken } as any,
            },
        };
    }

    it('calls quotesService.getQuotePdf with the id and active companyId', async () => {
        const getQuotePdf = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
        const ctx = buildContext(getQuotePdf);

        await getQuotePdfTool.handler(ctx, { quoteId: 'q1' });

        expect(getQuotePdf).toHaveBeenCalledWith('q1', 'company1');
    });

    it('mints a download token scoped to the quote and active company', async () => {
        const getQuotePdf = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
        const createToken = jest.fn().mockResolvedValue('rawtoken');
        const ctx = buildContext(getQuotePdf, createToken);

        await getQuotePdfTool.handler(ctx, { quoteId: 'q1' });

        expect(createToken).toHaveBeenCalledWith('company1', 'QUOTE', 'q1');
    });

    it('returns the PDF bytes as a base64 resource block that round-trips exactly, plus a download link', async () => {
        const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]); // "%PDF-" + junk
        const getQuotePdf = jest.fn().mockResolvedValue(pdfBytes);
        const ctx = buildContext(getQuotePdf);

        const result = await getQuotePdfTool.handler(ctx, { quoteId: 'q1' });

        const resourceBlock = result.content.find((c) => c.type === 'resource') as
            | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } }
            | undefined;
        expect(resourceBlock).toBeDefined();
        expect(resourceBlock!.resource.mimeType).toBe('application/pdf');
        expect(resourceBlock!.resource.uri).toBe('invoicerr://quotes/q1.pdf');

        const decoded = Buffer.from(resourceBlock!.resource.blob, 'base64');
        expect(Buffer.compare(decoded, Buffer.from(pdfBytes))).toBe(0);

        expect(result.structuredContent).toEqual({
            quoteId: 'q1',
            mimeType: 'application/pdf',
            sizeBytes: pdfBytes.length,
            downloadUrl: expect.stringContaining('/api/pdf-links/rawtoken'),
        });
    });
});
