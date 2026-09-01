import { z } from 'zod';

import { ItemType } from '../../../../prisma/generated/prisma/client';
import { hasScope } from '@/utils/scope-check';
import { ToolDescriptor } from './types';

const inputSchema = {};

const outputSchema = {
  articles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      type: z.nativeEnum(ItemType),
      unitPrice: z.number(),
      vatRate: z.number(),
    }),
  ),
};

// Reprised, unchanged in spirit, from the repère's own `list_articles` (git tag
// `avant-refonte-documents`) — a real business ENTITY, not a document type.
export const listArticlesTool: ToolDescriptor<typeof inputSchema> = {
  name: 'list_articles',
  description: "List the active company's reusable catalog articles (products/services).",
  isRegistered: (scopes) => hasScope({ scopes }, 'articles:read'),
  inputSchema,
  outputSchema,
  handler: async (ctx) => {
    const articles = await ctx.services.articlesService.findAll(ctx.companyId);
    const summary = articles.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      type: a.type,
      unitPrice: a.unitPrice,
      vatRate: a.vatRate,
    }));

    return {
      content: [{ type: 'text', text: `${summary.length} article(s) found.` }],
      structuredContent: { articles: summary },
    };
  },
};
