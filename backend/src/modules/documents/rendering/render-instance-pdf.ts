import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { guessCountryCode } from '@/utils/country-name-to-iso';

import { DocumentInstanceResult } from '../actions/action-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { resolveInvoiceNotes, ResolvedInvoiceNote } from '../mentions/invoice-notes';
import { defaultMentionsCatalog } from '../mentions/registry';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { computeDocumentTotals, DocumentTotals } from '../totals/compute-totals';
import { renderDocumentHtml } from './render-html';
import { renderPdf } from './render-pdf';

export interface RenderDocumentInstanceDeps {
  referenceRegistry: EntityReferenceRegistry;
}

/**
 * Root TODO item 15 ("mentions obligatoires") — resolves the printed footer block for ONE instance.
 * Gated on `descriptor.usesLegalMentions` (types.ts's own header on why this is a document-TYPE
 * flag, not inferred from field presence): every non-invoice type today returns `[]` unconditionally,
 * so its own PDF is byte-for-byte unchanged by this task.
 *
 * `company.country` is the free-text column the country picker writes (the same field
 * `formats/semantic/build-semantic-invoice.ts`'s own `guessCountryCode` resolves for the CII/UBL
 * export) — but UNLIKE that bridge, this function does NOT fall back to 'FR' when the country cannot
 * be resolved: that bridge's fallback is a pre-existing, documented product default for its own
 * concern (a party's postal address always needs SOME country code to serialize); inventing the same
 * default here, for a DIFFERENT concern (which country's law applies), would be a guess this task's
 * own "never invent a rule" discipline forbids. A company with a genuinely unresolvable country
 * simply prints no mentions in its PDF — never a throw, and never a silently-assumed jurisdiction.
 *
 * `issueDate` is read from the instance's own `data.issueDate` — the same field name
 * `formats/shared-build.ts` reads for BT-2, invoice-specific by construction (see that file's own
 * header): a document TYPE with no such field never sets `usesLegalMentions` in the first place, so
 * this function is never asked to resolve one for it. A missing or unparseable value returns `[]`
 * rather than guessing "today" — resolveInvoiceNotes` must be handed the document's OWN issue date,
 * never a stand-in, or the freeze property (`mentions/schema.ts`'s own header) would be silently
 * broken for exactly the record that most needs it (a document with bad data on file).
 */
export function legalMentionsFor(
  descriptor: DocumentTypeDescriptor,
  companyCountry: string | null | undefined,
  data: Record<string, unknown>,
): ResolvedInvoiceNote[] {
  if (!descriptor.usesLegalMentions) return [];

  const rawIssueDate = data.issueDate;
  if (typeof rawIssueDate !== 'string' && typeof rawIssueDate !== 'number') return [];
  const issueDate = new Date(rawIssueDate);
  if (Number.isNaN(issueDate.getTime())) return [];

  const countryCode = guessCountryCode(companyCountry ?? undefined);
  return resolveInvoiceNotes(defaultMentionsCatalog.fileFor(countryCode), issueDate);
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
    legalMentions: legalMentionsFor(descriptor, company.country, instanceData),
  });

  const pdf = await renderPdf(html);

  return { pdf, totals, referenceLabels, companyName: company.name };
}
