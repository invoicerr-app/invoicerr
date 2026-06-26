---
sidebar_position: 2
---

# E-mails & Webhooks

## Email Templates

Personnalisez le corps des e-mails envoyés aux clients lors de l'envoi de devis pour signature ou de factures par e-mail. Prend en charge des variables dynamiques.

:::info Fournisseur d'e-mail
L'envoi des e-mails lui-même (SMTP ou Brevo) se configure au niveau de l'instance via des variables d'environnement, pas depuis cette page. Voir [Installation Docker](../../getting-started/docker-installation.md#envoi-des-e-mails).
:::

## Webhooks

Configurez des endpoints webhook pour recevoir des événements en temps réel (ex. `quote.signed`, `invoice.paid`). Consultez le [guide développeur Webhooks](../../developer-guide/webhooks.md) pour les types d'événements et les payloads.
