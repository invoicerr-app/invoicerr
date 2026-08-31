/**
 * Reprise du raisonnement de `avant-refonte-documents:backend/src/compliance/providers/archive/
 * storage.ts` (`computeContentHash`) — SHA-256 réel sur chaque artefact, dans l'ordre du tableau.
 * Chaque artefact est ENCADRÉ par un en-tête stable (`role|mime|byteLength\n`) avant ses octets bruts,
 * pour que le hachage :
 *   - couvre CHAQUE artefact archivé, pas seulement le premier ;
 *   - soit non ambigu sur où finissent les octets d'un artefact et où commencent ceux du suivant — une
 *     concaténation NUE laisserait deux jeux d'artefacts DIFFÉRENTS entrer en collision (ou se décaler
 *     l'un dans l'autre) dans le même hachage ; l'en-tête préfixé par la longueur l'exclut ;
 *   - change si les octets d'un artefact sont modifiés, ou si un artefact est ajouté / retiré /
 *     réordonné.
 * Déterministe pour une entrée identique. Retourne de l'hexadécimal minuscule (64 caractères pour
 * SHA-256).
 *
 * Adapté du repère, sciemment : PAS de champ `syntax` séparé dans l'en-tête. Le repère encadrait
 * `role|syntax|mime|byteLength` parce que son propre `SignedArtifact` portait les deux axes
 * indépendamment (un même `role` pouvant se décliner en plusieurs `syntax`). Ce module-ci n'a pas cet
 * axe distinct : le `role` EST déjà le format livré ('pdf', 'facturx', 'fa3', 'fatturapa' — voir
 * `transports/*-transport.ts`), jamais un rôle générique partagé par deux syntaxes différentes.
 * Retirer un champ qui ne porterait ici aucune information distincte n'affaiblit pas l'encadrement :
 * chaque dimension qui distingue réellement deux artefacts (rôle, type MIME, longueur) reste dans
 * l'en-tête, et la propriété anti-collision qui compte — deux jeux d'artefacts différents ne peuvent
 * jamais produire la même suite d'octets encadrés — tient toujours.
 */
import { createHash } from 'node:crypto';

/** Un artefact RÉELLEMENT livré, prêt à être haché/archivé — jamais un artefact qu'un transport
 *  aurait pu produire mais n'a pas envoyé. */
export interface ArchivedArtifactInput {
  /** Ce que cet artefact EST — 'pdf' (le PDF humainement lisible, signé s'il l'était) ou l'id du
   *  format structuré réellement déposé/soumis ('facturx' | 'fa3' | 'fatturapa' — voir
   *  `formats/format-provider.ts#DocumentFormatProvider.id`). Jamais un rôle générique partagé par
   *  deux formats différents (voir l'en-tête de ce fichier). */
  role: string;
  mime: string;
  bytes: Uint8Array;
}

/** Le hachage PLAIN (non encadré) d'UN SEUL artefact — ce que `verify` nomme "attendu" pour CET
 *  artefact précis quand il rapporte CORROMPU. Distinct de `computeContentHash` (qui hache l'ENSEMBLE
 *  encadré, ordonné) : celui-ci sert à savoir LEQUEL des artefacts d'une archive a été altéré. */
export function computeArtifactHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Voir l'en-tête de ce fichier. */
export function computeContentHash(artifacts: ArchivedArtifactInput[]): string {
  const hash = createHash('sha256');
  for (const artifact of artifacts) {
    hash.update(`${artifact.role}|${artifact.mime}|${artifact.bytes.length}\n`, 'utf8');
    hash.update(artifact.bytes);
  }
  return hash.digest('hex');
}
