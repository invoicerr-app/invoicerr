---
sidebar_position: 4
---

# Devis

La page **Quotes** vous permet de créer des devis, de les envoyer à vos clients pour signature et de transformer les devis signés en factures.

## Actions

- **Add New** — créer un devis
- **Search** — rechercher par titre, numéro de devis ou nom du client
- **Filter** — basculer les badges **Draft**, **Sent** et **Signed**
- **View** (icône œil) — détails en lecture seule
- **View PDF** / **Download PDF** — prévisualiser ou sauvegarder le devis au format `quote-{numero}.pdf`
- **Edit** (icône crayon) — disponible tant que le devis n'est pas signé
- **Send for signature** (icône signature) — envoyer au client un lien de signature sécurisé ; recliquez pour renvoyer
- **Create invoice** (icône plus) — apparaît quand le devis est **Signed**, le transforme en facture
- **Delete** (icône poubelle) — disponible tant que le devis n'est pas signé

## Créer un devis

Cliquez sur **Add New** et remplissez :

- **Client** (obligatoire) et **Title** (optionnel)
- **Currency** et **Payment Method** (optionnels)
- **Line items** — chaque ligne a une Description, un Type, une Quantité, un Prix unitaire et un Taux de TVA ; glisser-déposer pour réordonner
- **Discount Rate** (0–100 %), **Valid Until** (date) et **Notes** (tout optionnel)

## Statuts

| Statut | Signification |
| --- | --- |
| **Draft** | Créé, pas encore envoyé — modifiable et supprimable |
| **Sent** | Envoyé au client pour signature |
| **Signed** | Approuvé par le client — prêt à être converti en facture |
| **Expired** | La date *Valid Until* est dépassée |

## Le flux

1. Créez un devis et cliquez sur **Send for signature**.
2. Le client le signe en ligne — voir [Signature de devis](quote-signing.md).
3. Une fois **Signed**, cliquez sur **Create invoice** pour tout reporter dans une [facture](invoices.md).

## Premier usage

Sans aucun devis, la page affiche *"No quotes yet"* et un bouton **Add New**.
