/**
 * Reads the four facts `classify.ts` compares against country data: the seller's country and
 * resolved company profile, the buyer's type and country, the document's issue date, and the nature
 * of its lines. Kept apart from the pure classifier so the rules stay testable without a database,
 * and apart from the runner so the send trigger and the report job classify an operation the same
 * way (the same context is rebuilt at each call, never cached across a retry).
 */
import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';

import { resolveCompanyCountryCode, resolveCompanyProfile } from '../country-policy/country-policy';
import { findOwnedDocument } from '../persistence';
import { DeclarationOperation, LineNature } from './classify';

/** `ItemType` is the articles module's own enum; read as strings here so this file never depends on
 *  the generated Prisma enum's spelling. */
function natureOfArticle(type: string | undefined): LineNature | undefined {
  if (type === 'SERVICE') return 'service';
  if (type === 'PRODUCT') return 'goods';
  return undefined;
}

function issueDateOf(data: Record<string, unknown>): string {
  const raw = data.issueDate;
  if (typeof raw === 'string' && raw.trim()) return raw.slice(0, 10);
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return '';
}

export interface OperationContextInput {
  companyId: string;
  typeId: string;
  documentId: string;
  kind?: 'invoice' | 'payment';
  payment?: { amountMinor: number; paidAt: string };
}

export async function loadDeclarationOperation(input: OperationContextInput): Promise<DeclarationOperation> {
  const document = await findOwnedDocument(input.companyId, input.typeId, input.documentId);
  const data = (document.data ?? {}) as Record<string, unknown>;

  const clientId = typeof data.client === 'string' && data.client ? data.client : undefined;
  const lineRows = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : [];

  const articleIds = [
    ...new Set(
      lineRows
        .map((line) => (typeof line?.articleId === 'string' ? line.articleId : undefined))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [sellerCountryCode, companyProfile, client, articles] = await Promise.all([
    resolveCompanyCountryCode(input.companyId),
    resolveCompanyProfile(input.companyId),
    clientId
      ? prisma.client.findFirst({
          where: { id: clientId, companyId: input.companyId },
          select: { type: true, country: true, countryCode: true },
        })
      : Promise.resolve(null),
    articleIds.length > 0
      ? prisma.article.findMany({
          where: { id: { in: articleIds }, companyId: input.companyId },
          select: { id: true, type: true },
        })
      : Promise.resolve([]),
  ]);

  const articleNature = new Map<string, LineNature>();
  for (const article of articles) {
    const nature = natureOfArticle(article.type);
    if (nature) articleNature.set(article.id, nature);
  }

  // A line with no article, or an article this company no longer owns, leaves the invoice's nature
  // unknown. Never default it to goods: a payment declaration on a service invoice would then be
  // silently skipped.
  let lineNatures: LineNature[] | undefined = [];
  for (const line of lineRows) {
    const articleId = typeof line?.articleId === 'string' ? line.articleId : undefined;
    const nature = articleId ? articleNature.get(articleId) : undefined;
    if (!nature) {
      lineNatures = undefined;
      break;
    }
    lineNatures.push(nature);
  }
  if (lineRows.length === 0) lineNatures = undefined;

  const buyerCountryCode = client
    ? client.countryCode || guessCountryCode(client.country ?? undefined) || undefined
    : undefined;

  return {
    kind: input.kind ?? 'invoice',
    sellerCountryCode,
    buyerType: (client?.type as DeclarationOperation['buyerType']) ?? undefined,
    buyerCountryCode: buyerCountryCode?.toUpperCase(),
    documentIssueDate: issueDateOf(data),
    companyProfile: companyProfile as Record<string, string>,
    vatOnCollection:
      companyProfile.vatRegime !== 'FRANCHISE' && companyProfile.vatDebitsOption !== 'EXERCISED',
    lineNatures,
    payment: input.payment,
  };
}
