/**
 * Persistance Prisma de l'archive légale (root TODO item 14) — même discipline que
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
import { Prisma } from '../../../../prisma/generated/prisma/client';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { ArchivedArtifactInput, computeArtifactHash, computeContentHash } from './hashing';
import { persistArtifacts, readArchivedArtifact } from './storage';
import { computeRetention } from './retention/compute-retention';
import { defaultRetentionCatalog, RetentionCatalog } from './retention/registry';

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
