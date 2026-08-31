/**
 * Reprise minimale du `SupplyType` du moteur de conformité supprimé (`compliance/types.ts` au repère
 * `avant-refonte-documents`) — seules les deux valeurs que `business-process.ts` consomme survivent
 * ici. Le nouveau descripteur (`invoice.descriptor.ts`) n'a PAS de champ "nature de la ligne" (bien/
 * service) par ligne ; ce type existe uniquement pour que `frenchBusinessProcessCode` reste
 * typée et testable indépendamment de tout appelant réel — voir `business-process.ts`'s propre
 * en-tête pour pourquoi rien dans ce ticket n'alimente encore ce type depuis une vraie donnée.
 */
export type SupplyType = 'GOODS' | 'SERVICES';
