import { Currency, ItemType } from '../../../../prisma/generated/prisma/client';

import { ToolDescriptor } from './types';
import { z } from 'zod';

const itemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  quantity: z.number(),
  unitPrice: z.number(),
  vatRate: z.number(),
  type: z.nativeEnum(ItemType),
  order: z.number(),
  quoteItemId: z.string().optional(),
});

const inputSchema = {
  clientId: z
    .string()
    .describe(
      'ID of the client this invoice is for. If you only have a client name from the user, call list_clients ' +
        'first to resolve it — do not call create_client just to obtain an id.',
    ),
  quoteId: z.string().optional().describe('ID of the quote this invoice originates from, if any'),
  dueDate: z.string().datetime().optional().describe('ISO 8601 date-time'),
  currency: z.nativeEnum(Currency).optional(),
  discountRate: z.number().optional(),
  paymentMethod: z.string().optional(),
  paymentDetails: z.string().optional(),
  paymentMethodId: z.string().optional(),
  notes: z.string(),
  items: z.array(itemSchema).min(1),
};

const outputSchema = {
  id: z.string(),
  number: z.number(),
  rawNumber: z.string().nullable(),
};

export const createInvoiceTool: ToolDescriptor<typeof inputSchema> = {
  name: 'create_invoice',
  description:
    'Create a new invoice for a client in the active company. Use create_invoice_from_quote instead when ' +
    'the invoice should come from an existing quote. Requires a clientId — if the user only gave a client ' +
    "name, call list_clients first to find the right id (and confirm with the user if there's ambiguity) " +
    'instead of creating a new client.',
  scope: 'invoices:write',
  inputSchema,
  outputSchema,
  handler: async (ctx, input) => {
    const invoice = await ctx.services.invoicesService.createInvoice(ctx.companyId, {
      ...input,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
    });

    return {
      content: [
        { type: 'text', text: `Invoice ${invoice.rawNumber || invoice.number} created (id: ${invoice.id}).` },
      ],
      structuredContent: { id: invoice.id, number: invoice.number, rawNumber: invoice.rawNumber ?? null },
    };
  },
};
