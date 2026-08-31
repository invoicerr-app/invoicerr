/**
 * Reprise minimale du `SupplyType` du moteur de conformité supprimé (`compliance/types.ts` au repère
 * `avant-refonte-documents`) — seules les deux valeurs que `business-process.ts` consomme survivent
 * ici.
 *
 * DÉSORMAIS ALIMENTÉ PAR UNE VRAIE DONNÉE : le tronc de `invoice.descriptor.ts` n'a toujours pas de
 * champ "nature de la ligne" — c'est l'OVERLAY pays FR (`country-fields/data/fr.json`) qui ajoute un
 * sous-champ `supplyType` (kind 'select', valeurs 'GOODS'/'SERVICES', OPTIONNEL) à `lines`, exactement
 * les deux valeurs de ce type — jamais un `if` dans `invoice.descriptor.ts` lui-même, qui reste
 * country-blind. Voir `country-fields/data/fr.json`'s own header pour le choix (option a : sous-champ
 * de ligne plutôt qu'un champ document unique) et `formats/shared-build.ts#extractLines` pour où la
 * valeur brute (une chaîne quelconque tapée côté client) est resserrée sur ce type strict — toute
 * autre valeur est traitée comme absente, jamais devinée.
 */
export type SupplyType = 'GOODS' | 'SERVICES';
