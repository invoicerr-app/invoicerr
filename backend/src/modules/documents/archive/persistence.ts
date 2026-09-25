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

  const { uri, contentHash } = await persistArtifacts(documentId, artifacts);
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
  const { uri, contentHash } = await persistArtifacts(documentId, [artifact]);
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

/**
 * The manual-acceptance manifest's own shape - written by `actions/quote-manual-acceptance.ts`, read
 * back by `findManualAcceptanceArchive` below. Declared HERE, not in the `actions/` module that
 * writes it, so this file's own read side never needs to import back into `actions/` (which itself
 * imports this file to write one) - the same "define the shared shape on the lower-level side"
 * discipline `ArchivedArtifactInput` (hashing.ts) already holds for every archive writer.
 */
export interface ManualAcceptanceManifest {
  kind: 'manual-acceptance';
  documentId: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  note: string;
  /** ISO 8601 - when the issuer recorded the acceptance (server time), never the client's own claimed
   *  date, which lives inside `note` if they mentioned one at all. */
  acceptedAt: string;
}

/** The artifact role a manual-acceptance manifest is stored under - see `DocumentArchiveKind`'s own
 *  schema comment on the `ACCEPTANCE` kind. Exported so `actions/quote-manual-acceptance.ts` (the
 *  writer) and this file's own read side below agree on the exact same string without either one
 *  hand-typing it twice. */
export const MANUAL_ACCEPTANCE_ROLE = 'manual-acceptance';

/**
 * Archives ONE manual quote acceptance (issue #421) - the same WORM discipline every archive in this
 * file holds (content-hashed, `storage.ts`), under its own `kind: ACCEPTANCE` (see that enum's own
 * schema comment for why VERDICT/DELIVERY were both wrong fits). Unlike `createAuthorityVerdictArchive`
 * above, this NEVER refuses for lack of a parent: a manual acceptance is itself a genuine event
 * regardless of whether the quote's own DELIVERY archive exists (a prior `lastArchiveError`, say) -
 * blocking it on that would make a PRESERVATION problem about an unrelated, earlier write also swallow
 * a real business action that has nothing to do with it. When a DELIVERY archive DOES exist, its
 * retention is copied verbatim (same reasoning as VERDICT's own: this evidence is about THAT document,
 * it has no retention life independent of it); otherwise retention is resolved fresh, the exact same
 * way `createDocumentArchive` above does for its own first-ever archive of a document.
 */
export async function createManualAcceptanceArchive(input: {
  companyId: string;
  documentId: string;
  /** The manifest bytes - `actions/quote-manual-acceptance.ts`'s own JSON, already serialized (this
   *  file never knows its shape, the same "content is the caller's business" discipline
   *  `createDocumentArchive` already holds for a DELIVERY's own artifacts). */
  manifest: Uint8Array;
}): Promise<DocumentArchiveResult> {
  const { companyId, documentId, manifest } = input;
  const artifacts: ArchivedArtifactInput[] = [
    { role: MANUAL_ACCEPTANCE_ROLE, mime: 'application/json', bytes: manifest },
  ];
  const { uri, contentHash } = await persistArtifacts(documentId, artifacts);
  const archivedAt = new Date();

  const parent = await prisma.documentArchive.findFirst({
    where: { companyId, documentId, kind: DocumentArchiveKind.DELIVERY },
    orderBy: { archivedAt: 'desc' },
  });

  let retentionUntil: Date | null;
  let retentionBasis: string | null;
  let retentionCalcVersion: number | null;
  if (parent) {
    retentionUntil = parent.retentionUntil;
    retentionBasis = parent.retentionBasis;
    retentionCalcVersion = parent.retentionCalcVersion;
  } else {
    const countryCode = await resolveCompanyCountryCode(companyId);
    const retentionFile = defaultRetentionCatalog.fileFor(countryCode);
    const issueDate = await resolveDocumentIssueDate(companyId, documentId);
    const resolved = computeRetention(retentionFile, archivedAt, issueDate);
    retentionUntil = resolved.retentionUntil;
    retentionBasis = resolved.retentionBasis;
    retentionCalcVersion = CURRENT_RETENTION_CALC_VERSION;
  }

  const created = await prisma.documentArchive.create({
    data: {
      companyId,
      documentId,
      kind: DocumentArchiveKind.ACCEPTANCE,
      parentArchiveId: parent?.id ?? null,
      contentHash,
      uri,
      artifacts: toArtifactMetas(artifacts) as unknown as Prisma.InputJsonValue,
      archivedAt,
      retentionUntil,
      retentionBasis,
      retentionCalcVersion,
    },
  });

  return toResult(created);
}

/**
 * The most recent manual-acceptance manifest actually archived for this document, read back off
 * storage (never off the `artifacts` metadata column alone, which never carries the note/actor text -
 * only role/mime/byteLength/sha256, see `StoredArtifactMeta`) - `null` for a document that was never
 * manually accepted, or whose manifest is no longer readable from storage (the same honest "cannot
 * prove it" answer `findArchivedPdfArtifact` above gives, never a thrown error over a read this cheap).
 * Used both by `documents.service.ts`'s own read endpoint (the detail page's "Acceptance" section -
 * this app has no document history/timeline view; that section is a current-state summary, not a
 * log) and by this feature's own archive-distinction test - the SAME function proves the manifest was
 * actually written AND lets it be displayed, rather than two independent readers of the same fact.
 */
export async function findManualAcceptanceArchive(
  companyId: string,
  documentId: string,
): Promise<ManualAcceptanceManifest | null> {
  const archive = await prisma.documentArchive.findFirst({
    where: { companyId, documentId, kind: DocumentArchiveKind.ACCEPTANCE },
    orderBy: { archivedAt: 'desc' },
  });
  if (!archive) return null;

  const bytes = await readArchivedArtifact(archive.uri, MANUAL_ACCEPTANCE_ROLE, 'application/json');
  if (!bytes) return null;

  try {
    return JSON.parse(bytes.toString('utf8')) as ManualAcceptanceManifest;
  } catch {
    // Corrupted/truncated bytes - same "cannot prove it, never throw" posture as a missing file.
    return null;
  }
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

/**
 * Looks for a human-readable, already-final PDF among the artifacts this document's most recent
 * DELIVERY archive actually preserved — used by `documents.service.ts#renderInstancePdf` to skip the
 * Chromium render entirely whenever one already exists, rather than re-rendering (and, if configured,
 * re-signing) bytes that were already produced and archived at send time.
 *
 * Matches ONLY `role: 'pdf'` (`send-document-email.ts`'s own archived artifact for the "email"
 * transport) — the SAME `rendering/render-instance-pdf.ts` composition `renderInstancePdf` itself
 * runs, PAdES-signed if that was configured AT SEND TIME (`renderInstancePdf`'s own header), so those
 * bytes are byte-for-byte what a fresh render would produce today for an unedited, already-sent
 * document. Deliberately does NOT match "pdp"/"chorus-pro"'s own `role: 'facturx'` artifact even
 * though ITS mime is also `application/pdf` (a Factur-X file is a real, renderable PDF/A-3): that
 * artifact is what was actually DEPOSITED at the authority, built by a pipeline that never applies
 * this company's PAdES signature — serving it here would silently change what "GET .../pdf" has
 * always meant for exactly the companies who configured signing. `null` for a document with no
 * DELIVERY archive at all (a draft, a document whose archiving attempt itself failed —
 * `lastArchiveError`), for one delivered through "ksef"/"sdi" (their own archived artifact is XML,
 * never a PDF), and for the credit note's transport-less "send" (nothing archived at all) — the
 * caller falls back to rendering fresh in every one of those cases, exactly as it always has.
 */
export async function findArchivedPdfArtifact(companyId: string, documentId: string): Promise<Buffer | null> {
  const archive = await prisma.documentArchive.findFirst({
    where: { companyId, documentId, kind: DocumentArchiveKind.DELIVERY },
    orderBy: { archivedAt: 'desc' },
  });
  if (!archive) return null;

  const metas = (archive.artifacts ?? []) as unknown as StoredArtifactMeta[];
  const pdfMeta = metas.find((meta) => meta.role === 'pdf' && meta.mime === 'application/pdf');
  if (!pdfMeta) return null;

  return readArchivedArtifact(archive.uri, pdfMeta.role, pdfMeta.mime);
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
    const bytes = await readArchivedArtifact(archive.uri, meta.role, meta.mime);
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
