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
});

const inputSchema = {
  clientId: z
    .string()
    .describe(
      'ID of the client this quote is for. If you only have a client name from the user, call list_clients ' +
        'first to resolve it — do not call create_client just to obtain an id.',
    ),
  title: z.string().optional(),
  validUntil: z.string().datetime().optional().describe('ISO 8601 date-time'),
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

export const createQuoteTool: ToolDescriptor<typeof inputSchema> = {
  name: 'create_quote',
  description:
    'Create a new quote for a client in the active company. Requires a clientId — if the user only gave ' +
    "a client name, call list_clients first to find the right id (and confirm with the user if there's " +
    'ambiguity) instead of creating a new client.',
  scope: 'quotes:write',
  inputSchema,
  outputSchema,
  handler: async (ctx, input) => {
    const quote = await ctx.services.quotesService.createQuote(ctx.companyId, {
      ...input,
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
    });

    return {
      content: [
        { type: 'text', text: `Quote ${quote.rawNumber || quote.number} created (id: ${quote.id}).` },
      ],
      structuredContent: { id: quote.id, number: quote.number, rawNumber: quote.rawNumber ?? null },
    };
  },
};
