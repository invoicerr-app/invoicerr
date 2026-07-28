import { ToolDescriptor } from './types';
import { z } from 'zod';

const inputSchema = {
  quoteId: z.string().describe('ID of the quote to invoice'),
  items: z
    .array(
      z.object({
        quoteItemId: z.string(),
        quantity: z
          .number()
          .describe(
            'Quantity to invoice for this quote item — must not exceed the remaining invoicable quantity',
          ),
      }),
    )
    .min(1),
};

const outputSchema = {
  id: z.string(),
  number: z.number(),
  rawNumber: z.string().nullable(),
};

export const createInvoiceFromQuoteTool: ToolDescriptor<typeof inputSchema> = {
  name: 'create_invoice_from_quote',
  description:
    "Create an invoice from an existing quote, for a partial or full selection of the quote's items.",
  scope: 'invoices:write',
  inputSchema,
  outputSchema,
  handler: async (ctx, input) => {
    const invoice = await ctx.services.invoicesService.createInvoiceFromQuote(ctx.companyId, input);

    return {
      content: [
        {
          type: 'text',
          text: `Invoice ${invoice.rawNumber || invoice.number} created from quote (id: ${invoice.id}).`,
        },
      ],
      structuredContent: { id: invoice.id, number: invoice.number, rawNumber: invoice.rawNumber ?? null },
    };
  },
};
