import { Prisma } from '../../../prisma/generated/prisma/client';
import { NotFoundException } from '@nestjs/common';
import prisma from '@/prisma/prisma.service';

import { DocumentInstanceResult } from './actions/action-registry';

/**
 * Shared, tenant-safe persistence for document instances — used by action handlers (e.g.
 * quote-actions.ts) and by DocumentsService's read endpoints, so every one of them scopes by
 * companyId the same way instead of each action re-deriving it.
 */

/** 404s (rather than returning null) when `id` doesn't exist or belongs to another company/type —
 *  the two cases are indistinguishable from the outside, which is the point. */
export async function findOwnedDocument(
  companyId: string,
  typeId: string,
  id: string,
): Promise<DocumentInstanceResult> {
  const document = await prisma.documentInstance.findFirst({ where: { id, companyId, typeId } });
  if (!document) {
    throw new NotFoundException(`Document "${id}" not found for type "${typeId}".`);
  }
  return document;
}

/** Creates a new instance, or updates an existing one owned by this company — used by any action
 *  that persists the document's current field values under a given status (e.g. "save-draft"). */
export async function upsertDocument(
  companyId: string,
  typeId: string,
  documentId: string | undefined,
  status: string,
  data: Record<string, unknown>,
): Promise<DocumentInstanceResult> {
  const jsonData = data as Prisma.InputJsonValue;

  if (documentId) {
    await findOwnedDocument(companyId, typeId, documentId);
    return prisma.documentInstance.update({
      where: { id: documentId },
      data: { status, data: jsonData },
    });
  }

  return prisma.documentInstance.create({
    data: { companyId, typeId, status, data: jsonData },
  });
}

/**
 * `take` defaults to 50 (the list screen's own page size budget) — a contribution that needs to
 * aggregate over more history (contributions/invoice-contributions.ts) passes a larger explicit
 * value rather than this function growing a second, uncapped code path. Still ordered by
 * `updatedAt`, same as ever: a contribution reading a large `take` is an honest "most recently
 * touched N documents" view, not a full, unbounded table scan.
 */
export async function listDocuments(
  companyId: string,
  typeId?: string,
  take = 50,
): Promise<DocumentInstanceResult[]> {
  return prisma.documentInstance.findMany({
    where: { companyId, ...(typeId ? { typeId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take,
  });
}

/** Permanently removes an owned instance — used by the generic "delete" action
 *  (actions/generic-actions.ts's registerDeleteAction). 404s via findOwnedDocument the same way every
 *  other single-document operation here does, before ever issuing the delete. */
export async function deleteDocument(
  companyId: string,
  typeId: string,
  id: string,
): Promise<DocumentInstanceResult> {
  await findOwnedDocument(companyId, typeId, id);
  return prisma.documentInstance.delete({ where: { id } });
}
