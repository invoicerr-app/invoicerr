---
sidebar_position: 4
---

# Factures

La page **Invoices** vous permet de facturer vos clients. Vous pouvez créer des factures de toutes pièces ou convertir un [devis](quotes.md) signé.

## Actions

- **Add New** — créer une facture unique ou récurrente
- **Search** — rechercher par numéro, titre ou nom du client
- **Filter** — basculer les badges **Sent**, **Unpaid**, **Overdue**, **Paid** et **Upcoming**
- **View** (icône œil) — détails en lecture seule
- **Download** — choisir **PDF**, **Factur-X**, **ZUGFeRD**, **XRechnung**, **UBL** ou **CII**
- **Send by email** — envoyer la facture par e-mail en PDF
- **Mark as paid** — enregistrer le paiement manuellement
- **Edit** (icône crayon) — disponible pour les factures impayées
- **Create receipt** (icône reçu) — générer un [reçu](receipts.md) depuis cette facture
- **Delete** (icône poubelle) — disponible pour les factures impayées

## Créer une facture

Cliquez sur **Add New** et remplissez :

- **Client** (obligatoire) et **Title** (optionnel)
- **Currency** et **Payment Method** (optionnels)
- **Type** — unique ou récurrente (avec fréquence et date de fin)
- **Line items** — Description, Type, Quantité, Prix unitaire et Taux de TVA ; glisser-déposer pour réordonner
- **Discount Rate** (0–100 %) et **Notes** (optionnels)

### Créer depuis un devis

Une fois qu'un devis est **Signed**, cliquez sur **Create invoice** sur le devis. Toutes les informations du client, les lignes et les détails sont repris. Vous pouvez ajuster avant de finaliser.

## Statuts

| Statut | Signification |
| --- | --- |
| **Sent** | Créée et envoyée au client |
| **Unpaid** | En attente de paiement |
| **Overdue** | Date d'échéance dépassée |
| **Paid** | Paiement reçu |
| **Upcoming** | Facture récurrente programmée pour la prochaine période |

## Formats de téléchargement

| Format | Utilisation |
| --- | --- |
| **PDF** | Facture imprimable standard |
| **Factur-X** | Norme de facturation électronique française (PDF + XML) |
| **ZUGFeRD** | Norme de facturation électronique allemande (PDF + XML) |
| **XRechnung** | Facturation électronique pour le secteur public allemand |
| **UBL** | Universal Business Language XML |
| **CII** | Cross-Industry Invoice XML |

## Premier usage

Sans aucune facture, la page affiche *"No invoices yet"* et un bouton **Add New**. Si vous avez un devis signé, utilisez **Create invoice** depuis la page [Devis](quotes.md) pour éviter la saisie.
