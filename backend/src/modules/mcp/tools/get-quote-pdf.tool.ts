import { ToolDescriptor } from './types';
import { z } from 'zod';

const inputSchema = {
  quoteId: z.string().describe('ID of the quote to fetch the PDF for'),
};

const outputSchema = {
  quoteId: z.string(),
  mimeType: z.literal('application/pdf'),
  sizeBytes: z.number(),
  downloadUrl: z.string(),
};

export const getQuotePdfTool: ToolDescriptor<typeof inputSchema> = {
  name: 'get_quote_pdf',
  description:
    'Fetch the PDF for a quote in the active company. Returns both an embedded base64-encoded binary ' +
    'resource block (rendering of which is not yet guaranteed to be visually supported by every MCP ' +
    'client) and a downloadUrl valid for 1 hour that works from any chat UI — always surface the ' +
    'downloadUrl to the user as a clickable link, since it works even where the client renders no preview.',
  scope: 'quotes:read',
  inputSchema,
  outputSchema,
  handler: async (ctx, input) => {
    const pdfBytes = await ctx.services.quotesService.getQuotePdf(input.quoteId, ctx.companyId);
    const blob = Buffer.from(pdfBytes).toString('base64');
    const token = await ctx.services.pdfLinksService.createToken(ctx.companyId, 'QUOTE', input.quoteId);
    // BETTER_AUTH_URL, not APP_URL: this link points at a backend-only
    // route (/api/pdf-links/:token), and APP_URL is the frontend's own
    // origin elsewhere in this codebase (e.g. signature-signing links),
    // which isn't guaranteed to route /api/* through to the backend.
    const downloadUrl = `${process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/api/pdf-links/${token}`;

    return {
      content: [
        {
          type: 'text',
          text: `Quote ${input.quoteId} PDF fetched (${pdfBytes.length} bytes). Download link (valid 1 hour): ${downloadUrl}`,
        },
        {
          type: 'resource',
          resource: { uri: `invoicerr://quotes/${input.quoteId}.pdf`, mimeType: 'application/pdf', blob },
        },
      ],
      structuredContent: {
        quoteId: input.quoteId,
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length,
        downloadUrl,
      },
    };
  },
};
