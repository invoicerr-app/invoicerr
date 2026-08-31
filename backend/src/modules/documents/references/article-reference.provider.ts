import { ArticlesService } from '@/modules/articles/articles.service';

import { EntityReferenceOption, EntityReferenceProvider } from './reference-registry';

/**
 * Wraps the SURVIVING `articles` module (backend/src/modules/articles/ — the one piece of the old,
 * pre-refactor architecture this branch keeps as-is: a plain catalog CRUD, no lifecycle, no status)
 * the exact same way client-reference.provider.ts wraps ClientsService: the document descriptor
 * system adds no article-specific logic of its own, only this thin adapter.
 *
 * This is the ONLY provider (today) that implements the OPTIONAL `getFields` — see that method's own
 * comment on reference-registry.ts. It is what backs a line's `prefillFrom: { entity: 'article', ... }`
 * (quote.descriptor.ts, invoice.descriptor.ts): `search`/`resolve` alone would only ever let a picker
 * show "which article", never actually copy its description/price/VAT rate onto the row.
 *
 * `getFields` returns `unitPrice` in MAJOR units (the same business-facing number
 * `ArticlesService.create`/`update` store on `Article.unitPrice`, e.g. `120` for "120.00 EUR") and
 * `vatRate` as a plain NUMBER (e.g. `20`) — never the minor-units column (`unitPriceMinor`, an
 * internal storage detail the document model has no use for) and never a pre-formatted string: the
 * frontend's own per-target-KIND coercion (array-field.tsx) is what turns `20` into the string `"20"`
 * a line's 'select' `vatRate` field actually stores, so this provider stays honest about what an
 * Article record IS, not what any one document field kind needs it to look like.
 */
export function buildArticleReferenceProvider(articlesService: ArticlesService): EntityReferenceProvider {
  return {
    async search(companyId, query): Promise<EntityReferenceOption[]> {
      const articles = await articlesService.findAll(companyId);
      const needle = query.trim().toLowerCase();
      const matching = needle ? articles.filter((a) => a.name.toLowerCase().includes(needle)) : articles;
      return matching.map((article) => ({ id: article.id, label: article.name }));
    },

    async resolve(companyId, id): Promise<EntityReferenceOption | null> {
      const article = await articlesService.findOne(companyId, id);
      return article ? { id: article.id, label: article.name } : null;
    },

    async getFields(companyId, id): Promise<Record<string, unknown> | null> {
      const article = await articlesService.findOne(companyId, id);
      if (!article) return null;
      return {
        name: article.name,
        description: article.description,
        unitPrice: article.unitPrice,
        vatRate: article.vatRate,
      };
    },
  };
}
