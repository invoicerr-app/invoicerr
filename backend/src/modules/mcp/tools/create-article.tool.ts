import { ItemType } from '../../../../prisma/generated/prisma/client';

import { ToolDescriptor } from './types';
import { z } from 'zod';

const inputSchema = {
  name: z.string().describe('Label shown in the article picker'),
  description: z.string().optional().describe('Text injected into the line item when this article is used'),
  type: z.nativeEnum(ItemType).optional(),
  unitPrice: z.number().optional(),
  vatRate: z.number().optional(),
};

const outputSchema = {
  id: z.string(),
  name: z.string(),
};

export const createArticleTool: ToolDescriptor<typeof inputSchema> = {
  name: 'create_article',
  description: 'Add a new reusable catalog article (product or service) to the active company.',
  scope: 'articles:write',
  inputSchema,
  outputSchema,
  handler: async (ctx, input) => {
    const article = await ctx.services.articlesService.create(ctx.companyId, input);

    return {
      content: [{ type: 'text', text: `Article "${article.name}" created (id: ${article.id}).` }],
      structuredContent: { id: article.id, name: article.name },
    };
  },
};
