import { ItemType } from '../../../../prisma/generated/prisma/client';

import { ToolDescriptor } from './types';
import { z } from 'zod';

const inputSchema = {};

const outputSchema = {
    articles: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        type: z.nativeEnum(ItemType),
        unitPrice: z.number(),
        vatRate: z.number(),
    })),
};

export const listArticlesTool: ToolDescriptor<typeof inputSchema> = {
    name: 'list_articles',
    description: 'List the active company\'s reusable catalog articles (products/services).',
    scope: 'articles:read',
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
