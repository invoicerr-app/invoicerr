import { getInvoicePdfTool } from './get-invoice-pdf.tool';
import { ToolContext } from './types';

describe('getInvoicePdfTool', () => {
    function buildContext(getInvoicePdf: jest.Mock, createToken: jest.Mock = jest.fn().mockResolvedValue('rawtoken')): ToolContext {
        return {
            companyId: 'company1',
            scopes: ['invoices:read'],
            services: {
                invoicesService: { getInvoicePdf } as any,
                quotesService: {} as any,
                clientsService: {} as any,
                articlesService: {} as any,
                pdfLinksService: { createToken } as any,
            },
        };
    }

    it('calls invoicesService.getInvoicePdf with the active companyId and id', async () => {
        const getInvoicePdf = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
        const ctx = buildContext(getInvoicePdf);

        await getInvoicePdfTool.handler(ctx, { invoiceId: 'i1' });

        expect(getInvoicePdf).toHaveBeenCalledWith('company1', 'i1');
    });

    it('mints a download token scoped to the invoice and active company', async () => {
        const getInvoicePdf = jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
        const createToken = jest.fn().mockResolvedValue('rawtoken');
        const ctx = buildContext(getInvoicePdf, createToken);

        await getInvoicePdfTool.handler(ctx, { invoiceId: 'i1' });

        expect(createToken).toHaveBeenCalledWith('company1', 'INVOICE', 'i1');
    });

    it('returns the PDF bytes as a base64 resource block that round-trips exactly, plus a download link', async () => {
        const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 4, 5, 6]); // "%PDF-" + junk
        const getInvoicePdf = jest.fn().mockResolvedValue(pdfBytes);
        const ctx = buildContext(getInvoicePdf);

        const result = await getInvoicePdfTool.handler(ctx, { invoiceId: 'i1' });

        const resourceBlock = result.content.find((c) => c.type === 'resource') as
            | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } }
            | undefined;
        expect(resourceBlock).toBeDefined();
        expect(resourceBlock!.resource.mimeType).toBe('application/pdf');
        expect(resourceBlock!.resource.uri).toBe('invoicerr://invoices/i1.pdf');

        const decoded = Buffer.from(resourceBlock!.resource.blob, 'base64');
        expect(Buffer.compare(decoded, Buffer.from(pdfBytes))).toBe(0);

        expect(result.structuredContent).toEqual({
            invoiceId: 'i1',
            mimeType: 'application/pdf',
            sizeBytes: pdfBytes.length,
            downloadUrl: expect.stringContaining('/api/pdf-links/rawtoken'),
        });
    });
});
