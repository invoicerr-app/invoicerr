/**
 * Le point d'accroche de l'archivage légal (root TODO item 14) sur l'envoi asynchrone —
 * `actions/async-send.ts`'s phase-2 (`deliver()` déjà réussi, le document déjà écrit "sent") appelle
 * `archiveDeliveredArtifactsIfAny` juste après cette écriture, jamais avant : archiver ce qui n'a pas
 * encore été livré serait un mensonge (une archive prétendant conserver un envoi qui pourrait encore
 * échouer).
 *
 * ## La garantie que cette fonction tient : elle NE PROPAGE JAMAIS D'EXCEPTION
 *
 * "Un échec d'archivage ne doit PAS annuler un envoi déjà livré" (root TODO item 14) — au moment où
 * cette fonction est appelée, l'e-mail est déjà parti / le dépôt est déjà accepté, c'est un FAIT
 * acquis, et rien ici ne doit pouvoir le remettre en cause. `async-send.ts` appelle donc ceci APRÈS
 * avoir persisté "sent" et sans l'englober dans un try/catch de son cru — c'est CETTE fonction qui
 * absorbe tout, jusqu'à l'échec de sa PROPRE écriture de compensation (`lastArchiveError`).
 *
 * ## "Jamais silencieux" : `lastArchiveError`, pas `lastActionError`
 *
 * Voir `schema.prisma`'s own comment sur `DocumentInstance.lastArchiveError` pour le raisonnement
 * complet. En bref : `lastActionError` est remis à null par TOUTE écriture ordinaire
 * (`persistence.ts#upsertDocument`) et signifie "l'ACTION déclarée a échoué" — un envoi archivé en
 * échec n'est PAS un envoi qui a échoué (il a réussi ; c'est sa CONSERVATION qui a un problème). Un
 * champ dédié, jamais touché ailleurs, est donc le seul moyen honnête de rendre ce fait interrogeable
 * sans le confondre avec l'échec d'une action ni le faire disparaître au prochain "save-draft".
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { ArchivedArtifactInput } from './hashing';
import { createDocumentArchive } from './persistence';

export interface ArchiveDeliveredArtifactsInput {
  companyId: string;
  documentId: string;
  /** Ce que `deliver()` a réellement livré — voir `transports/transport-registry.ts`'s
   *  `DocumentTransportResult.artifacts`'s own header. Absent, ou vide, pour une livraison qui n'a
   *  produit AUCUN artefact conservable (le "send" du credit-note, `credit-note-actions.ts` — une
   *  simple transition de statut, sans transport ni e-mail) : rien à archiver n'est pas un échec, ce
   *  n'est simplement rien à faire. */
  artifacts: ArchivedArtifactInput[] | undefined;
}

/**
 * Ne lève JAMAIS — voir l'en-tête de ce fichier. Appelée depuis `actions/async-send.ts` juste après
 * l'écriture "sent", inconditionnellement pour tout type/transport (générique, comme le reste de
 * `async-send.ts` — rien ici ne nomme "invoice" ni "pdp").
 */
export async function archiveDeliveredArtifactsIfAny(input: ArchiveDeliveredArtifactsInput): Promise<void> {
  const { companyId, documentId, artifacts } = input;
  if (!artifacts || artifacts.length === 0) return;

  try {
    await createDocumentArchive({ companyId, documentId, artifacts });
    // Efface une PRÉCÉDENTE panne d'archivage — un re-send qui archive avec succès cette fois n'a
    // plus besoin de garder la trace du raté de la tentative d'avant à côté d'un document désormais
    // effectivement conservé.
    await prisma.documentInstance.update({ where: { id: documentId }, data: { lastArchiveError: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Document archiving failed after a successful delivery', {
      category: 'documents',
      details: { companyId, documentId, message },
    });
    try {
      await prisma.documentInstance.update({
        where: { id: documentId },
        data: { lastArchiveError: message },
      });
    } catch (writeError) {
      // Si MÊME cette écriture de compensation échoue (base indisponible…), l'échec est déjà loggé
      // au niveau error ci-dessus — la livraison, elle, a déjà réellement abouti et doit le rester :
      // rien ici ne doit jamais remonter jusqu'à `async-send.ts`.
      logger.error('Could not even record the archiving failure on the document itself', {
        category: 'documents',
        details: {
          companyId,
          documentId,
          message: writeError instanceof Error ? writeError.message : String(writeError),
        },
      });
    }
  }
}
