---
sidebar_position: 10
---

# Paramètres

La page **Settings** est organisée en onglets, chacun couvrant un aspect différent de votre instance.

## Company

Votre identité commerciale — ces informations apparaissent sur chaque document émis.

- **Name** (obligatoire)
- **VAT Number** (optionnel)
- **Legal ID / SIRET** (optionnel)
- **Adresse** — Rue, Complément d'adresse, Code postal, Ville, État / Province, Pays
- **Email** et **Phone**
- **Website**
- **Currency** — devise par défaut pour les nouveaux documents
- **Date Format**
- **Logo** — téléchargez le logo de votre entreprise (apparaît sur les PDF)
- **Exempt VAT** — bascule pour désactiver la TVA sur tous les documents

### Numérotation des documents

- **Quote Number Format** et **Starting Number**
- **Invoice Number Format** et **Starting Number**
- **Receipt Number Format** et **Starting Number**

### Format PDF des factures

- Choisissez le format de facturation électronique par défaut : **PDF**, **Factur-X**, **ZUGFeRD**, **XRechnung**, **UBL** ou **CII**

## PDF Templates

Personnalisez l'apparence de vos documents PDF. Téléchargez un fichier CSS personnalisé ou ajustez les options de mise en page.

## Email Templates

Personnalisez le corps des e-mails envoyés aux clients lors de l'envoi de devis pour signature ou de factures par e-mail. Prend en charge les variables dynamiques.

## Webhooks

Configurez des endpoints webhook pour recevoir des événements en temps réel (ex. `quote.signed`, `invoice.paid`). Consultez le [guide développeur Webhooks](../developer-guide/webhooks.md) pour les types d'événements et les payloads.

## API Keys

Générez et gérez des clés API pour un accès programmatique. Chaque clé peut être nommée et révoquée indépendamment.

## Logs

Consultez les journaux d'audit de l'activité de votre instance — qui a fait quoi et quand.

## Account

Vos paramètres personnels : nom, e-mail, mot de passe et préférences de profil.

## Invitations

Invitez des membres de votre équipe dans votre instance. Saisissez leur e-mail et assignez un rôle. Les invitations en attente et acceptées sont listées ici.

## Plugins

Gérez les plugins installés. Téléchargez, activez ou désactivez des plugins pour étendre les fonctionnalités d'Invoicerr. Consultez le [guide développeur Plugin System](../developer-guide/plugin-system.md) pour le développement.

## Danger Zone

Actions destructrices pour les administrateurs de l'instance :

- **Delete all documents** — supprime tous les devis, factures et reçus (garde les clients et paramètres)
- **Delete instance** — supprime définitivement l'instance entière et toutes ses données
