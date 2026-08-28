# P2-V01 — Le rattachement français, vérifié en source primaire

> Légifrance, consulté le **2026-08-28**. Les deux articles sont cités dans leur version **en
> vigueur depuis le 21/02/2026**, modifiée par la LOI n° 2026-103 du 19 février 2026, art. 123 (V).
>
> Cette vérification conditionne la conception du déclencheur (`08-CORRIDOR-MODEL.md`) : elle est
> faite **avant** de coder, parce qu'elle peut changer la forme du prédicat. Elle l'a changée.

## 1. Le déclencheur de l'e-invoicing — art. 289 bis I

**Source** : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546660 — consulté le 2026-08-28

> « I. - Pour l'application de l'article 289 et par dérogation au VI du même article 289,
> l'émission, la transmission et la réception des factures relatives aux opérations mentionnées aux
> a et d du 1 du I dudit article 289 ainsi qu'aux acomptes s'y rapportant s'opèrent sous une forme
> électronique […] **lorsque l'émetteur de la facture et son destinataire sont des assujettis qui
> sont établis ou ont leur domicile ou leur résidence habituelle en France.** »

**Le déclencheur bilatéral est confirmé, littéralement** — les deux parties, pas une.

**Mais le critère est triple, et le modèle proposé le réduisait à un seul.** Le texte dit
« **établis ou** ont leur **domicile ou** leur **résidence habituelle** en France ». Trois
rattachements alternatifs. `EstablishmentPredicate` — « établissement » — nomme le premier et tait
les deux autres, alors qu'une personne physique assujettie peut être rattachée par son domicile ou
sa résidence habituelle sans être « établie » au sens d'un établissement stable.

→ **Conséquence pour P2-V02** : le prédicat porte sur le **rattachement** (*attachment*), dont
l'établissement n'est qu'un des trois cas. Le champ d'opération et le type se renomment en
conséquence.

## 2. La double exclusion des opérations intracommunautaires — art. 289 bis V

> « V. - Le présent article ne s'applique pas aux opérations mentionnées au 2° du II de
> l'article 289-0 **ou au 1° du I de l'article 262 ter**. »

L'art. 262 ter I 1° vise les **livraisons intracommunautaires exonérées**.

**La question posée était : ce cas relève-t-il de deux exclusions par des chemins différents ?
Oui, et les deux tiennent.**

| Chemin | Mécanisme | S'applique à FR→IT B2B biens |
| --- | --- | --- |
| **289 bis I** | le test bilatéral échoue — l'acquéreur italien n'est ni établi, ni domicilié, ni résident habituel en France | ✅ |
| **289 bis V** | exclusion explicite renvoyant à 262 ter I 1° | ✅ |

Les deux sont indépendants, et c'est ce qui compte pour le modèle : un prédicat qui n'implémenterait
que le test bilatéral donnerait le bon verdict ici **par accident**. Une livraison intracommunautaire
vers un acquéreur qui *serait* rattaché à la France — cas rare mais concevable — resterait exclue par
le V seul. **Le prédicat a donc besoin des deux règles, pas d'une.**

## 3. L'e-reporting — art. 290 I

**Source** : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000053546668 — consulté le 2026-08-28

> « I. - Les assujettis qui sont établis ou ont leur domicile ou leur résidence habituelle en France
> communiquent à l'administration sous forme électronique […] les données relatives aux opérations
> suivantes […] :
> 1° Les opérations réalisées au profit d'une personne assujettie suivantes :
> a) Les livraisons exonérées en application du I des articles 262 et **262 ter** ;
> […] c) Les prestations de services qui ne sont pas situées en France en application des
> articles 259 et 259 A ; »

**Les deux flux que le moteur route aujourd'hui vers le PDP relèvent bien de l'e-reporting :**

| Flux | Fondement | Régime dû |
| --- | --- | --- |
| FR→IT B2B **biens** | 290 I 1° a) — livraison exonérée au titre de 262 ter | **e-reporting** |
| FR→IT B2B **services** | 290 I 1° c) — prestation non située en France (art. 259) | **e-reporting** |
| FR→US B2B **biens** | 290 I 1° a) — livraison exonérée au titre de 262 I (exportation) | **e-reporting** |
| FR→US B2B **services** | 290 I 1° c) | **e-reporting** |

Le constat de `10-ACQUIS.md` §1.2 est donc **confirmé en source primaire** : produire
`DECENTRALIZED_CTC` et un canal PDP pour ces quatre cas est faux, dans les deux sens — un e-invoice
est émis là où la loi ne le demande pas, et la transmission de données due n'est pas émise.

**Et le champ de l'art. 290 est bien plus large que « transfrontalier ».** Il couvre aussi des
opérations purement françaises : 1° b) livraisons en France à un assujetti **non établi** en France,
2° b) livraisons B2C en France, 2° f) prestations B2C situées en France, et 3° les **acquisitions**.
Le profil FR n'encode aujourd'hui l'e-reporting que pour le rôle `B2C`. C'est très en deçà.

## 4. Le fondement juridique change de code au 2027-01-01

**Trouvé en lisant les articles, non recherché** — et cela concerne toutes les citations du dépôt.

Les deux articles portent la même mention :

> « **Abrogé par Ordonnance n° 2025-1247 du 17 décembre 2025 - art. 9** […] ces dispositions […]
> sont **abrogées à compter du 1er janvier 2027** […] maintenues en vigueur jusqu'à leur reprise par
> les mesures réglementaires mentionnées à l'article **L. 215-39** et au premier alinéa de l'article
> **L. 216-44 du code des impositions sur les biens et services** »

Pour l'art. 290, la reprise vise **L. 215-39**, **L. 216-56** al. 2 et **L. 216-55** dernier alinéa.

**Ce que ça implique.** Le mandat démarre au 2026-09-01 sur le CGI ; quatre mois plus tard le
fondement bascule vers le **CIBS**. Le fond n'est pas réputé changer — c'est une recodification à
droit constant, maintien en vigueur jusqu'à reprise — mais **toute citation `CGI art. 289 bis` du
dépôt et de l'audit devient obsolète au 2027-01-01**, y compris dans `fr.ts`,
`08-CORRIDOR-MODEL.md`, `11-FRANCE-RESTE-A-FAIRE.md` et `03-LEGAL-VERIFICATION.md`.

> `open_question` — **la recodification est-elle à droit constant sur le déclencheur lui-même ?**
> Non vérifié : je n'ai pas lu les articles L. 215-39, L. 216-44, L. 216-55 et L. 216-56 du CIBS.
> Tant que ce n'est pas fait, **rien ne doit être codé sur la foi d'une équivalence supposée** — le
> modèle est bâti sur le texte CGI en vigueur, qui l'est jusqu'au 2027-01-01 au moins, et la
> vérification CIBS est une tâche à part.

## 5. Ce que cela change dans le modèle

1. **Le prédicat porte sur le rattachement**, à trois branches — établissement, domicile, résidence
   habituelle — et non sur le seul établissement.
2. **Il faut deux règles pour la France, pas une** : le test bilatéral *et* l'exclusion explicite
   des opérations de l'art. 262 ter I 1° / 289-0 II 2°.
3. **L'e-reporting français n'est pas « le B2C »**. Le profil actuel l'y réduit ; l'art. 290 I
   couvre quatre familles d'opérations dont trois n'ont rien à voir avec le rôle de l'acheteur.
4. **Les citations juridiques ont une date de péremption** au 2027-01-01, et le dépôt n'en porte
   aucune trace.
