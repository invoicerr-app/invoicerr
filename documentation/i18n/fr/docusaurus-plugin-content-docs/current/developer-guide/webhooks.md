---
sidebar_position: 3
---

# Système de webhooks

Les webhooks sortants permettent à des services externes de réagir aux événements qui se produisent dans Invoicerr (facture payée, devis signé, client créé, etc.).

## Mécanisme d'envoi

Les services appellent `webhookDispatcher.dispatch(WebhookEvent.SOME_EVENT, payload)` (voir `backend/src/modules/webhooks/webhook-dispatcher.service.ts`). Le dispatcher :

1. Recherche les webhooks configurés pour cet événement et l'entreprise concernée.
2. Appelle la méthode `send()` du service de webhooks, qui route vers le driver configuré — HTTP générique, Slack, Discord, Microsoft Teams.
3. Signe le payload avec HMAC-SHA256 en utilisant le secret du webhook.

## Événements disponibles

L'énumération `WebhookEvent` (`backend/prisma/schema.prisma`) couvre une cinquantaine d'événements répartis par domaine, par exemple :

- **Devis** : `QUOTE_CREATED`, `QUOTE_SENT`, `QUOTE_SIGNED`, `QUOTE_EXPIRED`, `QUOTE_REJECTED`, `QUOTE_STATUS_CHANGED`, ...
- **Factures** : `INVOICE_CREATED`, `INVOICE_SENT`, `INVOICE_PAID`, `INVOICE_OVERDUE`, `INVOICE_MARKED_AS_PAID`, `INVOICE_STATUS_CHANGED`, ...
- **Reçus** : `RECEIPT_CREATED`, `RECEIPT_CREATED_FROM_INVOICE`, `RECEIPT_SENT`, ...
- Plus des événements pour les paiements, les clients, l'entreprise, les signatures et les factures récurrentes.

## Ajouter un nouvel événement de webhook

1. Ajoutez la nouvelle valeur à l'énumération `WebhookEvent` dans `backend/prisma/schema.prisma`.
2. Exécutez `npx prisma migrate dev` pour régénérer les types Prisma.
3. Appelez `webhookDispatcher.dispatch(WebhookEvent.YOUR_NEW_EVENT, { ...payload })` depuis le service concerné, à l'endroit où se produit le changement d'état sous-jacent.

## Webhooks entrants de plugins

Distincts de l'envoi sortant, les plugins peuvent aussi recevoir des webhooks entrants de services tiers (p. ex. les rappels de finalisation de signature). Voir [Système de plugins](./plugin-system.md#webhooks-entrants-de-plugins).
