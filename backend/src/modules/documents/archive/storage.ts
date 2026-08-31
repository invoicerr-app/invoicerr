/**
 * Persistance locale durable des octets archivés — reprise de la forme de `avant-refonte-documents:
 * backend/src/compliance/providers/archive/storage.ts#LocalArchiveProvider`/`persistArtifacts` (voir
 * `providers.ts` du même repère pour `WormS3ArchiveProvider`, dont la NOTE D'HONNÊTETÉ est reprise par
 * `README` implicite de ce module : aucun credential S3 n'existe ici non plus, donc AUCUN provider
 * `s3://` n'est même tenté — voir le TODO racine item 14's own report pour le dire explicitement).
 *
 * `archiveRoot()` est relu à CHAQUE appel (jamais mis en cache au chargement du module) — exactement
 * comme le repère : un test peut ainsi repointer `DOCUMENTS_ARCHIVE_DIR` vers un `os.tmpdir()` sans
 * jamais risquer d'écrire dans le répertoire de travail du projet.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ArchivedArtifactInput, computeContentHash } from './hashing';

/** Racine du dépôt d'archives. `DOCUMENTS_ARCHIVE_DIR` si défini (les tests le repointent vers un
 *  sous-répertoire d'`os.tmpdir()`) ; sinon `<cwd>/.documents-archive` — le même défaut "dev-friendly"
 *  que `LocalArchiveProvider` du repère. Lu à neuf sur CHAQUE appel, jamais mis en cache. */
export function archiveRoot(): string {
  return resolve(process.env.DOCUMENTS_ARCHIVE_DIR ?? join(process.cwd(), '.documents-archive'));
}

export function extFor(mime: string): string {
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'application/xml') return 'xml';
  return 'bin';
}

/** Le répertoire où les octets d'une archive donnée vivent : content-hash-addressed, comme le repère
 *  — réarchiver un jeu d'artefacts byte-identique retombe sur le MÊME chemin (idempotent, aucune
 *  duplication), tandis qu'un jeu modifié (donc un `contentHash` différent) atterrit ailleurs.
 *  `documentId` PARTICIPE au chemin (contrairement au repère, où le hash seul suffisait) : deux
 *  documents distincts qui produiraient — improbablement mais pas impossiblement — le même
 *  `contentHash` (un même PDF envoyé deux fois à des clients différents, octet pour octet) ne doivent
 *  jamais partager un répertoire, ce qui romprait l'immuabilité de l'un des deux le jour où l'autre
 *  serait réarchivé avec un contenu différent. */
function archiveDir(documentId: string, contentHash: string): string {
  return join(archiveRoot(), documentId, contentHash);
}

/**
 * Écrit chaque artefact sous `<root>/<documentId>/<contentHash>/<role>.<ext>` et retourne l'URI
 * `file://` du répertoire. `contentHash` est calculé ICI (jamais passé par l'appelant) pour qu'il ne
 * puisse jamais dévier de ce que ces octets, dans cet ordre, hachent réellement.
 */
export function persistArtifacts(
  documentId: string,
  artifacts: ArchivedArtifactInput[],
): { uri: string; contentHash: string } {
  const contentHash = computeContentHash(artifacts);
  const dir = archiveDir(documentId, contentHash);
  mkdirSync(dir, { recursive: true });
  for (const artifact of artifacts) {
    const fileName = `${artifact.role}.${extFor(artifact.mime)}`.toLowerCase();
    writeFileSync(join(dir, fileName), Buffer.from(artifact.bytes));
  }
  return { uri: `file://${dir}`, contentHash };
}

/** Lit les octets d'un artefact déjà archivé, par son rôle/mime — utilisé par `persistence.ts#verify`
 *  pour re-hacher ce qui est réellement sur disque. `null` (jamais une exception) si le fichier
 *  n'existe pas/plus : un fichier manquant EST une des formes de corruption que `verify` doit nommer,
 *  pas une erreur qui ferait échouer l'appel HTTP tout entier. */
export function readArchivedArtifact(uri: string, role: string, mime: string): Buffer | null {
  const dir = uri.replace(/^file:\/\//, '');
  const fileName = `${role}.${extFor(mime)}`.toLowerCase();
  try {
    return readFileSync(join(dir, fileName));
  } catch {
    return null;
  }
}
