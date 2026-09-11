/**
 * Persistance Prisma de l'archive légale — même discipline que
 * `documents/persistence.ts` : des fonctions plates, scopées par `companyId`, jamais une classe.
 *
 * AUCUNE fonction de modification ou de suppression n'existe ici, et c'est délibéré : une fois écrite,
 * une ligne `DocumentArchive` n'est plus jamais réécrite par ce code — voir le commentaire du modèle
 * dans `schema.prisma`. `verifyDocumentArchive` (ci-dessous) RE-HACHE les octets stockés à chaque
 * appel mais n'écrit jamais son verdict en base : même une exécution qui découvre une corruption ne
 * mute rien ici.
 */
import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { DocumentArchiveKind, Prisma } from '../../../../prisma/generated/prisma/client';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { ArchivedArtifactInput, computeArtifactHash, computeContentHash } from './hashing';
import { persistArtifacts, readArchivedArtifact } from './storage';
import { computeRetention } from './retention/compute-retention';
import { defaultRetentionCatalog, RetentionCatalog } from './retention/registry';
import { AttestedDeposit, buildVerdictArtifact, TerminalAuthorityVerdict } from './verdict-artifact';

/** Ce que `artifacts` (colonne Json) contient réellement — le hachage PLAIN par artefact (jamais les
 *  octets eux-mêmes, qui vivent sous `uri` — voir storage.ts) sert à nommer LEQUEL des artefacts a été
 *  altéré quand `verify` rapporte CORROMPU. */
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
}

function toArtifactMetas(artifacts: ArchivedArtifactInput[]): StoredArtifactMeta[] {
  return artifacts.map((a) => ({
    role: a.role,
    mime: a.mime,
    byteLength: a.bytes.length,
    sha256: computeArtifactHash(a.bytes),
  }));
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
  };
}

/**
 * Écrit UNE archive pour les artefacts réellement livrés — appelée uniquement par
 * `archive-on-send.ts`, jamais directement par un contrôleur (pas de route qui créerait une archive à
 * la demande : une archive n'existe QUE parce qu'une livraison a réellement eu lieu).
 *
 * La rétention (⚖, item 14) est résolue ICI, au moment de l'écriture, pour le pays de la société
 * ÉMETTRICE — jamais recalculée plus tard : une archive garde la règle qui s'appliquait au moment où
 * elle a été faite, la même discipline que `mentions/invoice-notes.ts` applique aux mentions figées à
 * l'émission.
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
    // Défensif — voir archive-on-send.ts's own header : l'appelant ne devrait jamais appeler ceci
    // avec un tableau vide (il court-circuite avant), mais une archive sans aucun artefact serait un
    // enregistrement mensonger ("quelque chose a été livré et conservé") pour rien de réel.
    throw new Error(`Cannot archive document "${documentId}": no artifacts were actually delivered.`);
  }

  const { uri, contentHash } = persistArtifacts(documentId, artifacts);
  const artifactMetas = toArtifactMetas(artifacts);
  const archivedAt = new Date();

  const countryCode = await resolveCompanyCountryCode(companyId);
  const retentionFile = retentionCatalog.fileFor(countryCode);
  const { retentionUntil, retentionBasis } = computeRetention(retentionFile, archivedAt);

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
        // own.
        retentionUntil: parent.retentionUntil,
        retentionBasis: parent.retentionBasis,
      },
    ],
    skipDuplicates: true,
  });

  return count > 0 ? { archived: true } : { archived: false, reason: 'duplicate' };
}

/** Toutes les archives d'un document, les plus récentes d'abord — un re-send en produit plusieurs
 *  (voir le modèle `DocumentArchive`'s own schema comment), jamais une seule "courante" à remplacer. */
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

/** 404 (jamais null) pour un id qui n'existe pas ou appartient à une autre société/document — même
 *  discipline que `documents/persistence.ts#findOwnedDocument`. */
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
  /** Le hachage PLAIN attendu pour cet artefact (`StoredArtifactMeta.sha256`), ou le hachage encadré
   *  global attendu quand `role` vaut `"(overall)"` — voir le commentaire ci-dessous. */
  expected: string;
  /** Le hachage réellement obtenu en relisant le fichier, ou `null` si le fichier est absent. */
  actual: string | null;
}

export type ArchiveVerificationResult =
  | { status: 'intact' }
  | { status: 'corrupted'; details: ArchiveMismatch[] };

/**
 * RE-HACHE les octets réellement présents sur le disque et les compare au hachage ENREGISTRÉ — jamais
 * une simple relecture de la colonne `contentHash` (qui ne prouverait rien sur les octets eux-mêmes).
 * Deux niveaux de vérification :
 *  1. par artefact — le hachage PLAIN de chaque fichier relu contre son `sha256` stocké
 *     (`StoredArtifactMeta`), ce qui permet de NOMMER lequel est en cause ;
 *  2. l'ensemble — le hachage ENCADRÉ recalculé sur les artefacts relus (dans l'ordre stocké) contre
 *     `contentHash`, qui détecterait un réordonnancement ou une substitution qu'une comparaison
 *     artefact-par-artefact isolée ne verrait pas si, par une coïncidence adversariale, deux artefacts
 *     échangeaient leurs octets sans qu'aucun `sha256` individuel ne change (rôle `"(overall)"` dans
 *     le rapport).
 * Ne modifie jamais la ligne en base — voir l'en-tête de ce fichier.
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
