import { ToolDescriptor } from './types';
import { z } from 'zod';

const inputSchema = {
    invoiceId: z.string().describe('ID of the invoice to fetch the PDF for'),
};

const outputSchema = {
    invoiceId: z.string(),
    mimeType: z.literal('application/pdf'),
    sizeBytes: z.number(),
    downloadUrl: z.string(),
};

export const getInvoicePdfTool: ToolDescriptor<typeof inputSchema> = {
    name: 'get_invoice_pdf',
    description:
        'Fetch the PDF for an invoice in the active company. Returns both an embedded base64-encoded binary ' +
        'resource block (rendering of which is not yet guaranteed to be visually supported by every MCP ' +
        'client) and a downloadUrl valid for 1 hour that works from any chat UI — always surface the ' +
        'downloadUrl to the user as a clickable link, since it works even where the client renders no preview.',
    scope: 'invoices:read',
    inputSchema,
    outputSchema,
    handler: async (ctx, input) => {
        const pdfBytes = await ctx.services.invoicesService.getInvoicePdf(ctx.companyId, input.invoiceId);
        const blob = Buffer.from(pdfBytes).toString('base64');
        const token = await ctx.services.pdfLinksService.createToken(ctx.companyId, 'INVOICE', input.invoiceId);
        // BETTER_AUTH_URL, not APP_URL: see get-quote-pdf.tool.ts for why.
        const downloadUrl = `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/api/pdf-links/${token}`;

        return {
            content: [
                { type: 'text', text: `Invoice ${input.invoiceId} PDF fetched (${pdfBytes.length} bytes). Download link (valid 1 hour): ${downloadUrl}` },
                { type: 'resource', resource: { uri: `invoicerr://invoices/${input.invoiceId}.pdf`, mimeType: 'application/pdf', blob } },
            ],
            structuredContent: { invoiceId: input.invoiceId, mimeType: 'application/pdf', sizeBytes: pdfBytes.length, downloadUrl },
        };
    },
};
