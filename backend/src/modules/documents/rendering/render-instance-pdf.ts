import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { computeDocumentTotals, DocumentTotals } from '../totals/compute-totals';
import { renderDocumentHtml } from './render-html';
import { renderPdf } from './render-pdf';

export interface RenderDocumentInstanceDeps {
  referenceRegistry: EntityReferenceRegistry;
}

export interface RenderedDocumentInstance {
  pdf: Buffer;
  /** REUSED by the send path's email template (`actions/email-template.ts`'s `totalGross`) — this is
   *  the ONE `computeDocumentTotals` call for a given send, never a second one. */
  totals: DocumentTotals;
  /** REUSED the same way, for `recipientName` — see `buildEmailTemplateParts`. */
  referenceLabels: Record<string, string>;
  /** REUSED for `companyName` — the exact name already fetched to put in the PDF's own header. */
  companyName: string;
}

/**
 * The ONE place the HTML->PDF pipeline (renderDocumentHtml + renderPdf), the reference-label
 * resolution, and the totals computation are composed for a single document instance. Extracted out
 * of `DocumentsService.renderInstancePdf` (documents.service.ts, now a thin wrapper around this
 * function) so the document-SEND paths — the quote's own "send" (actions/generic-actions.ts) and the
 * invoice's "email" transport (transports/email-transport.ts) — attach the EXACT SAME PDF a user gets
 * from "GET /documents/:id/pdf", instead of a second implementation of any of this (see
 * actions/send-document-email.ts, the shared caller both of those go through).
 *
 * Takes the DESCRIPTOR already resolved by the caller, deliberately, rather than a `typeId` plus a
 * `DocumentTypeRegistry`: `DocumentsService`'s own "GET .../pdf" route resolves the MERGED descriptor
 * (native fields + whatever a third party attached via `ActionExtensionRegistry` — see
 * `mergedDescriptor`); the send paths resolve only the type's NATIVE one
 * (`DocumentTypeRegistry.resolve`). Both are the SAME descriptor for rendering purposes — an
 * extension only ever adds to `actions`, never to `fields` (`ActionExtensionRegistry`'s own shape
 * proves it: it stores nothing but `DocumentActionDescriptor`s), and `fields` is all this function
 * (and `computeDocumentTotals`) ever reads. Depending on `ActionExtensionRegistry` here to compute
 * the merge anyway would also be a genuine CIRCULAR dependency, not a shortcut: that registry is
 * itself built FROM `ActionRegistry` (documents.module.ts's `buildActionExtensionRegistry`), which is
 * exactly where the send actions this function serves are registered. Accepting an already-resolved
 * descriptor sidesteps the question instead of fighting it.
 */
export async function renderDocumentInstance(
  deps: RenderDocumentInstanceDeps,
  companyId: string,
  descriptor: DocumentTypeDescriptor,
  instance: Pick<DocumentInstanceResult, 'id' | 'status' | 'data' | 'createdAt' | 'displayNumber'>,
): Promise<RenderedDocumentInstance> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, address: true, city: true, postalCode: true, country: true },
  });
  if (!company) {
    throw new NotFoundException(`Company "${companyId}" not found.`);
  }

  const instanceData = (instance.data as Record<string, unknown>) || {};
  const referenceLabels: Record<string, string> = {};

  for (const field of descriptor.fields) {
    if (field.kind !== 'reference' || (!field.entity && !field.entities)) continue;

    const value = instanceData[field.key];
    if (!value) continue;

    let entityName: string | undefined;
    let refId: string | undefined;

    if (field.entities) {
      // Multi-target reference: value is { entity, id }
      const multiValue = value as { entity?: string; id?: string } | undefined;
      entityName = multiValue?.entity;
      refId = multiValue?.id;
    } else {
      // Single-target reference: value is just an id string
      entityName = field.entity;
      refId = String(value);
    }

    if (!entityName || !refId) continue;

    try {
      const resolved = await deps.referenceRegistry.resolve(entityName).resolve(companyId, refId);
      if (resolved?.label) {
        referenceLabels[field.key] = resolved.label;
      }
    } catch {
      // Gracefully fall back to the raw id if resolution fails (an unregistered entity, a dangling
      // reference) — a rendering gap must never block issuing/sending the document itself, the same
      // discipline DocumentsService.renderInstancePdf always held here.
      referenceLabels[field.key] = refId;
    }
  }

  const totals = computeDocumentTotals(descriptor, instanceData);

  const html = renderDocumentHtml({
    descriptor,
    instance: {
      id: instance.id,
      status: instance.status,
      data: instanceData,
      createdAt: instance.createdAt,
      displayNumber: instance.displayNumber,
    },
    company,
    referenceLabels,
    totals,
  });

  const pdf = await renderPdf(html);

  return { pdf, totals, referenceLabels, companyName: company.name };
}
