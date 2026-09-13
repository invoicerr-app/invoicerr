/**
 * Prisma persistence for the legal archive — same discipline as `documents/persistence.ts`: plain
 * functions, scoped by `companyId`, never a class.
 *
 * NO update or delete function exists here, and that is deliberate: once written, a `DocumentArchive`
 * row is never rewritten again by this code — see the model's own comment in `schema.prisma`.
 * `verifyDocumentArchive` (below) RE-HASHES the stored bytes on every call but never writes its
 * verdict back to the database: even a run that discovers corruption mutates nothing here.
 */
import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { DocumentArchiveKind, Prisma } from '../../../../prisma/generated/prisma/client';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { ArchivedArtifactInput, computeArtifactHash, computeContentHash } from './hashing';
import { persistArtifacts, readArchivedArtifact } from './storage';
import { CURRENT_RETENTION_CALC_VERSION } from './retention/calc-version';
import { computeRetention } from './retention/compute-retention';
import { defaultRetentionCatalog, RetentionCatalog } from './retention/registry';
import { AttestedDeposit, buildVerdictArtifact, TerminalAuthorityVerdict } from './verdict-artifact';

/** What `artifacts` (the Json column) actually holds — the PLAIN per-artifact hash (never the bytes
 *  themselves, which live under `uri` — see storage.ts) is used to name WHICH artifact was tampered
 *  with when `verify` reports CORRUPTED. */
export interface StoredArtifactMeta {
  role: string;
  mime: string;
  byteLength: number;
  sha256: string;
}

export interface DocumentArchiveResult {
  id: string;
  companyId: string;
  documentId: string;
  /** See `DocumentArchive`'s own schema comment — `'DELIVERY'` for every archive written before this
   *  field existed, and for every ordinary "artifact actually sent" archive since; `'VERDICT'` only
   *  for the authority's own later verdict on one of those. */
  kind: DocumentArchiveKind;
  /** Set only for `kind: 'VERDICT'` — the DELIVERY archive this verdict attests to. */
  parentArchiveId: string | null;
  contentHash: string;
  uri: string;
  artifacts: StoredArtifactMeta[];
  archivedAt: Date;
  retentionUntil: Date | null;
  retentionBasis: string | null;
  /** See `retention/calc-version.ts` and `schema.prisma`'s own comment on this column. NULL for any
   *  row written before this column existed — the UI (`document-archive-section.tsx`) shows a
   *  "may be stale" notice for those rather than trusting `retentionUntil` at face value. */
  retentionCalcVersion: number | null;
}

function toArtifactMetas(artifacts: ArchivedArtifactInput[]): StoredArtifactMeta[] {
  return artifacts.map((a) => ({
    role: a.role,
    mime: a.mime,
    byteLength: a.bytes.length,
    sha256: computeArtifactHash(a.bytes),
  }));
}

/**
 * The document's own `data.issueDate`, parsed — the SAME field name `formats/shared-build.ts` and
 * `rendering/render-instance-pdf.ts#legalMentionsFor` already read for this exact purpose (BT-2 /
 * the mentions freeze date). Never `archivedAt`: using the moment this archive happens to be written
 * as a stand-in for when the document was ISSUED is precisely the defect `compute-retention.ts`'s own
 * header exists to fix. Returns `undefined` — never "now", never a throw — for a document with no
 * parseable `issueDate` at all (a type with no such field, or a genuinely malformed one):
 * `computeRetention` already treats a missing issue date as "cannot resolve this rule" rather than a
 * license to guess, the same posture `transports/channel-policy/mandate.ts#isOnOrAfter` holds for the
 * very same field.
 */
async function resolveDocumentIssueDate(companyId: string, documentId: string): Promise<Date | undefined> {
  const document = await prisma.documentInstance.findFirst({
    where: { id: documentId, companyId },
    select: { data: true },
  });
  const rawIssueDate = (document?.data as Record<string, unknown> | undefined)?.issueDate;
  if (typeof rawIssueDate !== 'string' && typeof rawIssueDate !== 'number') return undefined;
  const issueDate = new Date(rawIssueDate);
  return Number.isNaN(issueDate.getTime()) ? undefined : issueDate;
}

function toResult(row: {
  id: string;
  companyId: string;
  documentId: string;
  kind?: DocumentArchiveKind;
  parentArchiveId?: string | null;
  contentHash: string;
  uri: string;
  artifacts: Prisma.JsonValue;
  archivedAt: Date;
  retentionUntil: Date | null;
  retentionBasis: string | null;
  // Optional for the same reason `kind`/`parentArchiveId` above are: offline test mocks constructing
  // a row by hand without this column (real Prisma rows always carry it once `prisma generate` has
  // run against the migrated schema).
  retentionCalcVersion?: number | null;
}): DocumentArchiveResult {
  return {
    id: row.id,
    companyId: row.companyId,
    documentId: row.documentId,
    // `?? 'DELIVERY'` covers only offline test mocks that construct a row by hand without the
    // column (real Prisma rows always carry it, `@default(DELIVERY)` — see the schema comment).
    kind: row.kind ?? DocumentArchiveKind.DELIVERY,
    parentArchiveId: row.parentArchiveId ?? null,
    contentHash: row.contentHash,
    uri: row.uri,
    artifacts: (row.artifacts ?? []) as unknown as StoredArtifactMeta[],
    archivedAt: row.archivedAt,
    retentionUntil: row.retentionUntil,
    retentionBasis: row.retentionBasis,
    retentionCalcVersion: row.retentionCalcVersion ?? null,
  };
}

/**
 * Writes ONE archive for the artifacts actually delivered — called only by `archive-on-send.ts`,
 * never directly by a controller (no route creates an archive on demand: an archive exists ONLY
 * because a delivery actually took place).
 *
 * Retention (⚖) is resolved HERE, at write time, for the ISSUING company's own country — never
 * recomputed later: an archive keeps the rule that applied at the moment it was made, the same
 * discipline `mentions/invoice-notes.ts` applies to mentions frozen at issue time. The duration
 * itself is counted from the document's own ISSUE date (`data.issueDate`, see
 * `resolveDocumentIssueDate` above) along the axis each rule declares
 * (`retention/schema.ts#RetentionOrigin`) — never from `archivedAt`, which is only the instant THIS
 * code happened to run and carries no legal weight of its own (see `retention/compute-retention.ts`).
 */
export async function createDocumentArchive(
  input: {
    companyId: string;
    documentId: string;
    artifacts: ArchivedArtifactInput[];
  },
  retentionCatalog: RetentionCatalog = defaultRetentionCatalog,
): Promise<DocumentArchiveResult> {
  const { companyId, documentId, artifacts } = input;
  if (artifacts.length === 0) {
    // Defensive — see archive-on-send.ts's own header: the caller should never call this with an
    // empty array (it short-circuits before reaching here), but an archive with no artifact at all
    // would be a dishonest record ("something was delivered and preserved") for nothing real.
    throw new Error(`Cannot archive document "${documentId}": no artifacts were actually delivered.`);
  }

  const { uri, contentHash } = persistArtifacts(documentId, artifacts);
  const artifactMetas = toArtifactMetas(artifacts);
  const archivedAt = new Date();

  const countryCode = await resolveCompanyCountryCode(companyId);
  const retentionFile = retentionCatalog.fileFor(countryCode);
  const issueDate = await resolveDocumentIssueDate(companyId, documentId);
  const { retentionUntil, retentionBasis } = computeRetention(retentionFile, archivedAt, issueDate);

  const created = await prisma.documentArchive.create({
    data: {
      companyId,
      documentId,
      contentHash,
      uri,
      artifacts: artifactMetas as unknown as Prisma.InputJsonValue,
      archivedAt,
      retentionUntil,
      retentionBasis,
      // See `retention/calc-version.ts` — names WHICH version of the algorithm above produced the two
      // fields just written, so a future fix to that algorithm (or today's UI reading rows from
      // before this column existed) can tell a stale calculation from a current one without ever
      // rewriting this row again.
      retentionCalcVersion: CURRENT_RETENTION_CALC_VERSION,
    },
  });

  return toResult(created);
}

/** What archiving a terminal authority verdict actually did — read by `archiveTerminalAuthorityVerdict`
 *  (the "never throws" wrapper, see that file's header) to decide whether the "no deposit
 *  archive" case deserves a loud log. `'duplicate'` is the EXPECTED steady state for every poll after
 *  the first that observes the same terminal status (see `verdictKey`'s own schema comment) — never
 *  logged as an error by the caller. */
export type VerdictArchiveOutcome =
  | { archived: true }
  | { archived: false; reason: 'duplicate' | 'no-deposit-archive' };

export interface TerminalVerdictInput extends TerminalAuthorityVerdict {
  companyId: string;
  documentId: string;
}

/**
 * Archives ONE terminal authority verdict (see `DocumentArchive`'s
 * own schema comment and `verdict-artifact.ts`'s header for the full reasoning) under the exact same
 * discipline `createDocumentArchive` above already holds for a deposit: content-hashed
 * (`hashing.ts`), persisted WORM-style (`storage.ts`), and — unlike a deposit — linked to, and given
 * the SAME retention as, the DELIVERY archive it attests to, rather than a freshly resolved one.
 *
 * Idempotent by construction: `verdictKey` (`${documentId}|${providerId}|${statusCode}`) is written
 * via `createMany`+`skipDuplicates`, the identical dedup idiom `authority-events.persistence.ts#
 * createAuthorityEvents` already uses for the very same event — a re-poll rediscovering an
 * already-archived terminal status (or a redelivered queue job) archives nothing a second time and
 * reports `{ archived: false, reason: 'duplicate' }`, never a second row nor an error.
 *
 * Never called for a document with no DELIVERY archive at all (a prior archiving failure —
 * `archive-on-send.ts`'s own `lastArchiveError`): there would be nothing honest to link this verdict
 * to, and no retention to copy — see this function's own "no-deposit-archive" branch. This is a REAL,
 * if rare, failure mode, surfaced to the caller rather than silently inventing a parent.
 */
export async function createAuthorityVerdictArchive(
  input: TerminalVerdictInput,
): Promise<VerdictArchiveOutcome> {
  const { companyId, documentId, providerId, statusCode } = input;

  // The most recent DELIVERY archive for this document — see this function's own header on why a
  // verdict is never archived without one. `kind` is filtered explicitly rather than relying on
  // "the first row" ordering alone: a document could, in principle, already carry an earlier VERDICT
  // row (from a previous terminal status this same provider reported first, e.g. a rejection
  // followed by a corrected re-submission under the same transportRef) that must never be mistaken
  // for the deposit itself.
  const parent = await prisma.documentArchive.findFirst({
    where: { companyId, documentId, kind: DocumentArchiveKind.DELIVERY },
    orderBy: { archivedAt: 'desc' },
  });
  if (!parent) {
    return { archived: false, reason: 'no-deposit-archive' };
  }

  const receivedAt = new Date();
  const deposit: AttestedDeposit = { documentId, archiveId: parent.id, contentHash: parent.contentHash };
  const artifact = buildVerdictArtifact(
    {
      providerId,
      statusCode,
      statusText: input.statusText,
      reason: input.reason,
      observedAt: input.observedAt,
      rawPayload: input.rawPayload,
    },
    deposit,
    receivedAt,
  );

  // Writing the bytes BEFORE the database row — same order `createDocumentArchive` above already
  // uses, and the same reason: `persistArtifacts` is idempotent (content-hash-addressed), so a
  // `createMany` that turns out to be a duplicate below has already, harmlessly, re-written the exact
  // same bytes to the exact same path rather than left a DB row pointing at nothing.
  const { uri, contentHash } = persistArtifacts(documentId, [artifact]);
  const verdictKey = `${documentId}|${providerId}|${statusCode}`;

  const { count } = await prisma.documentArchive.createMany({
    data: [
      {
        companyId,
        documentId,
        kind: DocumentArchiveKind.VERDICT,
        parentArchiveId: parent.id,
        verdictKey,
        contentHash,
        uri,
        artifacts: toArtifactMetas([artifact]) as unknown as Prisma.InputJsonValue,
        archivedAt: receivedAt,
        // Copied VERBATIM from the parent DELIVERY archive — never recomputed. See this model's own
        // schema comment: a verdict proves the fate of its deposit, it has no retention life of its
        // own. `retentionCalcVersion` travels with them for the same reason: the UI's "possibly
        // stale" notice must track the DEPOSIT's own calculation, not silently read as "current"
        // just because the verdict itself was archived today.
        retentionUntil: parent.retentionUntil,
        retentionBasis: parent.retentionBasis,
        retentionCalcVersion: parent.retentionCalcVersion,
      },
    ],
    skipDuplicates: true,
  });

  return count > 0 ? { archived: true } : { archived: false, reason: 'duplicate' };
}

/** Every archive for a document, most recent first — a re-send produces several of them (see the
 *  `DocumentArchive` model's own schema comment), never a single "current" one to replace. */
export async function listDocumentArchives(
  companyId: string,
  documentId: string,
): Promise<DocumentArchiveResult[]> {
  const rows = await prisma.documentArchive.findMany({
    where: { companyId, documentId },
    orderBy: { archivedAt: 'desc' },
  });
  return rows.map(toResult);
}

/** 404 (never null) for an id that does not exist or belongs to another company/document — the same
 *  discipline as `documents/persistence.ts#findOwnedDocument`. */
export async function findOwnedArchive(
  companyId: string,
  documentId: string,
  archiveId: string,
): Promise<DocumentArchiveResult> {
  const row = await prisma.documentArchive.findFirst({
    where: { id: archiveId, companyId, documentId },
  });
  if (!row) {
    throw new NotFoundException(`Archive "${archiveId}" not found for document "${documentId}".`);
  }
  return toResult(row);
}

export interface ArchiveMismatch {
  role: string;
  /** The PLAIN hash expected for this artifact (`StoredArtifactMeta.sha256`), or the expected
   *  overall framed hash when `role` is `"(overall)"` — see the comment below. */
  expected: string;
  /** The hash actually obtained by re-reading the file, or `null` if the file is missing. */
  actual: string | null;
}

export type ArchiveVerificationResult =
  | { status: 'intact' }
  | { status: 'corrupted'; details: ArchiveMismatch[] };

/**
 * RE-HASHES the bytes actually present on disk and compares them to the RECORDED hash — never a
 * plain re-read of the `contentHash` column (which would prove nothing about the bytes themselves).
 * Two levels of verification:
 *  1. per artifact — the PLAIN hash of each re-read file against its stored `sha256`
 *     (`StoredArtifactMeta`), which lets it NAME which one is at fault;
 *  2. the whole set — the FRAMED hash recomputed over the re-read artifacts (in stored order)
 *     against `contentHash`, which would catch a reordering or substitution that an isolated
 *     artifact-by-artifact comparison would miss if, by an adversarial coincidence, two artifacts
 *     swapped their bytes without any individual `sha256` changing (role `"(overall)"` in the
 *     report).
 * Never modifies the database row — see this file's own header.
 */
export async function verifyDocumentArchive(
  companyId: string,
  documentId: string,
  archiveId: string,
): Promise<ArchiveVerificationResult> {
  const archive = await findOwnedArchive(companyId, documentId, archiveId);

  const mismatches: ArchiveMismatch[] = [];
  const rehashed: ArchivedArtifactInput[] = [];

  for (const meta of archive.artifacts) {
    const bytes = readArchivedArtifact(archive.uri, meta.role, meta.mime);
    if (bytes === null) {
      mismatches.push({ role: meta.role, expected: meta.sha256, actual: null });
      continue;
    }
    const actual = computeArtifactHash(bytes);
    if (actual !== meta.sha256) {
      mismatches.push({ role: meta.role, expected: meta.sha256, actual });
    }
    rehashed.push({ role: meta.role, mime: meta.mime, bytes });
  }

  if (mismatches.length === 0 && rehashed.length === archive.artifacts.length) {
    const overall = computeContentHash(rehashed);
    if (overall !== archive.contentHash) {
      mismatches.push({ role: '(overall)', expected: archive.contentHash, actual: overall });
    }
  }

  if (mismatches.length === 0) return { status: 'intact' };
  return { status: 'corrupted', details: mismatches };
}
