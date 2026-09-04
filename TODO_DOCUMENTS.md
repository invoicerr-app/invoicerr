# TODO_DOCUMENTS — la couverture documentaire par pays (directive mandant, 2026-09-04)

> Verbatim mandant : « y'a des pays sans Policy (faut mettre un sub-agent par pays qui cherche
> tout ça et remplit les différents documents, il note dans un fichier de TODO genre
> TODO_DOCUMENTS si y'a des documents qui manquent à faire) ». Ce fichier est CE fichier de
> TODO : l'état par pays, et les manques consignés par les agents pays.
> Discipline inchangée (⚖ provenance ou refus de chargement, unverified jamais promu par
> raisonnement, mutations, batterie avant commit). Agents pays par LOTS de 3 (fichiers
> disjoints), validation mandataire par lot.

## Vague A — la doc elle-même (le générateur refondu) — feedback mandant intégral

1. **Langue** : la doc suit sa locale — le générateur émet EN dans docs/ ET FR dans
   i18n/fr/.../current/ ; les libellés (oui/non/restreinte, en-têtes, phrases d'explication)
   viennent d'une table de chaînes par locale, JAMAIS du prose des fichiers de données.
2. **Le prose des données ne fuit plus** : les notes/resolutionNotes (rédigées en français
   dans les data) ne sont PLUS déversées dans la doc — la doc rend des FAITS structurés
   (statut, source, date) dans la langue du lecteur ; les CITATIONS légales verbatim
   apparaissent dans un bloc « Source (langue originale) » clairement marqué — une citation ne
   se traduit pas, elle se cite.
3. **Colonne taxes refondue** : lire vat-rates/ ET tax-systems/ — TOUTES les catégories de
   taux du pays (normal/réduit/super-réduit/zéro/franchise…) avec la provenance PAR TAUX ;
   fini le taux unique. Corriger la donnée FR : tax-systems/fr.json est unverified alors que
   sa propre note documente les lectures directes (CGI 293 B, art. 278) — promouvoir en legal
   avec ces citations (⚖ : uniquement ce que la note documente déjà comme LU).
4. **Identifiers pour chaque pays** dans la matrice (colonne) et les pages pays.
5. **Mentions retirée de la matrice** (gardée en détail de page pays si présente).
6. **Pédagogie double lecture** : compréhensible par un novice ET utile à un pro — les termes
   techniques (B2G, CIUS, Peppol, EAS, Schematron, avoir, e-reporting, franchise…) portent une
   définition au survol (abbr/tooltip générés depuis un glossaire par locale dans le script).

## Vague B — un sub-agent par pays (par lots de 3)

Périmètre par pays : country-policy (les actions du vendeur, l'immutabilité), correction-routes
(les 11 voies), country-identifiers, vat-rates (toutes catégories), vérification channel-policy.
B2G : seulement si RÉELLEMENT livrable (CIUS officiel téléchargeable ET vendorable → le faire ;
sinon l'absence honnête reste, consignée ici — jamais un BIS générique contre une règle lue).
Tout ce qui n'est pas trouvé/atteignable : unverified avec ce qui trancherait + une entrée ici.

### État par pays (l'union de la matrice — 34)
| Pays | policy | b2g | correction | identifiers | vat-rates | Lot |
|---|---|---|---|---|---|---|
| FR DE IT PL ES MX US | ✓ | ✓ | ✓ | partiel | FR seul | — (compléter identifiers/vat-rates en vague B fin) |
| HU | ✓ | — | — | — | — | à venir |
| BE | — | ✓ | — | — | — | **Lot 1** |
| NL | — | — (NLCIUS à vendorer ?) | — | — | — | **Lot 1** |
| AT | — | — (ebInterface/CIUS AT) | — | — | — | **Lot 1** |
| CY EE GR LT LU LV MT SE | — | ✓ | — | — | — | lots suivants |
| BG CZ DK FI HR IE PT RO SI SK | — | — | — | — | — | lots suivants |
| AE + autres tax-only | — | — | — | — | — | à trier |

### Manques consignés par les agents (à remplir par eux)
(vide — chaque agent pays ajoute ici ce qu'il n'a pas pu faire, avec ce qui le débloquerait)
