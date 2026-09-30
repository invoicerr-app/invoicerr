/**
 * The legal archive of a document IMPORTED from a previous tool (issue #340): the original file
 * (PDF, or the structured XML the old tool issued: FatturaPA, KSeF FA(3), Factur-X/CII, XRechnung/
 * UBL) kept verbatim, exactly the way `persistence.ts#createDocumentArchive` keeps a DELIVERY
 * artifact. A dedicated writer, not a `kind` parameter on that function, the same "one function per
 * kind" shape `createAcceptanceArchive` (persistence.ts) already holds for ACCEPTANCE.
 *
 * Retention is resolved FRESH here, never copied from a parent: an imported document was never sent
 * by this application, so it has no DELIVERY archive to inherit from (unlike an ACCEPTANCE archive,
 * which piggybacks on the quote's own DELIVERY row when one exists). This is the exact same
 * fresh-resolution path `createDocumentArchive` itself uses for a document's FIRST archive (see that
 * function's own header), composed here with the issue date the IMPORT handler already has in hand
 * (the historical document's own `issueDate`, never `archivedAt`/today: the owner's own decision in
 * #340 is that the retention clock counts from the ORIGINAL date, not the day it was imported into
 * Invoicerr; see `archive/retention/schema.ts`'s own `origin` field, mandatory per rule, and this
 * file's own caller, `import/document-import.service.ts`, for why `issueDate` is passed in rather
 * than re-read off the row here).
 *
 * Deletion is blocked the same STRUCTURAL way every other legally significant document type's own
 * archive is here: no `delete` action is ever registered for `invoice`/`credit-note`
 * (descriptors/invoice.descriptor.ts, credit-note.descriptor.ts, see `generic-actions.ts`'s own
 * header on why those three types never got one), and `DocumentArchive` itself has no update/delete
 * code path anywhere in this module (`persistence.ts`'s own header, "IMMUTABLE BY DESIGN"). An
 * imported document's archive is exactly as undeletable as a sent one's: no NEW guard was needed.
 */
import prisma from '@/prisma/prisma.service';
import { DocumentArchiveKind, Prisma } from '../../../../prisma/generated/prisma/client';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { ArchivedArtifactInput, computeArtifactHash } from './hashing';
import { persistArtifacts } from './storage';
import { CURRENT_RETENTION_CALC_VERSION } from './retention/calc-version';
import { computeRetention } from './retention/compute-retention';
import { defaultRetentionCatalog } from './retention/registry';
import { DocumentArchiveResult, StoredArtifactMeta } from './persistence';

/** The one artifact role this archive ever carries: a single original file per import, never a
 *  format bridge's own multi-artifact set (a DELIVERY archive can carry a PDF *and* a structured
 *  file; an import carries only whatever the previous tool actually produced, verbatim). */
export const IMPORT_ORIGINAL_ROLE = 'import-original';

export interface ImportOriginalArchiveInput {
  companyId: string;
  documentId: string;
  /** The original file's own bytes, exactly as the previous tool produced them: never re-encoded,
   *  never converted from one format to another (BOI-CF-COM-10-10-30 §180, quoted in the research
   *  behind #340: a format conversion is fine for convenience, but the ORIGINAL must still be kept
   *  alongside it. This archive IS that original, so nothing here may transform it). */
  bytes: Uint8Array;
  mime: string;
  /** The historical document's own issue date (see this file's own header on why retention counts
   *  from it, never from the moment it was imported). */
  issueDate: Date;
}

/**
 * Writes the ONE `IMPORT_ORIGINAL` archive an imported document ever gets, called once, from the
 * import action's own handler (`import/document-import.service.ts`), on the same write that creates
 * the `DocumentInstance` row. Mirrors `persistence.ts#createDocumentArchive`'s own shape (content-hash the
 * artifact, persist it, resolve retention, write the row) with the two differences this kind actually
 * needs: a single fixed-role artifact (never a caller-supplied list) and a caller-supplied issue date
 * (there is no `DocumentInstance` row to re-read it off yet at the instant this typically runs, since
 * archiving and creation happen in the same handler, see that file's own call site).
 */
export async function createImportOriginalArchive(
  input: ImportOriginalArchiveInput,
): Promise<DocumentArchiveResult> {
  const { companyId, documentId, bytes, mime, issueDate } = input;
  const artifacts: ArchivedArtifactInput[] = [{ role: IMPORT_ORIGINAL_ROLE, mime, bytes }];
  const { uri, contentHash } = await persistArtifacts(documentId, artifacts);
  const archivedAt = new Date();

  const countryCode = await resolveCompanyCountryCode(companyId);
  const retentionFile = defaultRetentionCatalog.fileFor(countryCode);
  const resolved = computeRetention(retentionFile, archivedAt, issueDate);

  // Same per-artifact hashing `persistence.ts#toArtifactMetas` uses (the PLAIN, unframed SHA-256 of
  // each artifact's own bytes) - distinct from `contentHash` above, which is the FRAMED hash of the
  // whole, ordered artifact set (hashing.ts's own header). A single-artifact archive still keeps both
  // numbers, computed the same two ways every other archive in this module already computes them.
  const artifactMetas: StoredArtifactMeta[] = artifacts.map((a) => ({
    role: a.role,
    mime: a.mime,
    byteLength: a.bytes.length,
    sha256: computeArtifactHash(a.bytes),
  }));

  const created = await prisma.documentArchive.create({
    data: {
      companyId,
      documentId,
      kind: DocumentArchiveKind.IMPORT_ORIGINAL,
      contentHash,
      uri,
      artifacts: artifactMetas as unknown as Prisma.InputJsonValue,
      archivedAt,
      retentionUntil: resolved.retentionUntil,
      retentionBasis: resolved.retentionBasis,
      retentionCalcVersion: CURRENT_RETENTION_CALC_VERSION,
    },
  });

  const result: DocumentArchiveResult = {
    id: created.id,
    companyId: created.companyId,
    documentId: created.documentId,
    kind: created.kind,
    parentArchiveId: created.parentArchiveId,
    contentHash: created.contentHash,
    uri: created.uri,
    artifacts: artifactMetas,
    archivedAt: created.archivedAt,
    retentionUntil: created.retentionUntil,
    retentionBasis: created.retentionBasis,
    retentionCalcVersion: created.retentionCalcVersion,
  };
  return result;
}
