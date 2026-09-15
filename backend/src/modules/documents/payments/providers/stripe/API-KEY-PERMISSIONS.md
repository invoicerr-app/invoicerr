# Stripe — clé API restreinte pour Invoicerr

Ce dossier n'appelle qu'un seul endpoint Stripe : `POST /v1/checkout/sessions`
(`stripe-checkout-client.ts`). Les webhooks sont vérifiés localement par signature HMAC
(`stripe-signature.ts`, secret `whsec_…`) — aucun appel API n'est nécessaire pour ça.

Créer la clé dans le dashboard Stripe → Developers → API keys → **Create restricted key**,
en mode test pour `backend/.env.test.local`, en mode live pour une instance de production.

## Permissions

| Ressource | Permission | Pourquoi |
|---|---|---|
| Checkout Sessions | **Write** | Création de la session de paiement d'une facture (`POST /v1/checkout/sessions`) — le seul appel du code. |
| Payment Intents | Read | Relire un paiement pendant les tests réels et le diagnostic d'un webhook. |
| Charges and Refunds | Read | Idem, vérifier l'encaissement côté Stripe. |
| Events | Read | Relire un événement webhook reçu (`checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`). |
| Tout le reste | **None** | Customers, Products, Prices, Subscriptions, Payment Links, Webhook Endpoints, Connect, Issuing, Terminal, Tax, Billing… ne sont jamais appelés. |

Option : passer **Charges and Refunds** en Write si un remboursement depuis Invoicerr est ajouté
un jour (pas codé aujourd'hui).

## Webhook

Developers → Webhooks → Add endpoint (mode test), URL
`https://<instance>/api/public/payments/stripe/<companyId>/webhook`, événements :
`checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`.
En local : `stripe listen --forward-to localhost:4000/api/public/payments/stripe/<companyId>/webhook`.

## Variables

```
STRIPE_SECRET_KEY=rk_test_…        # ou sk_test_… ; rk_live_… en production
STRIPE_WEBHOOK_SECRET=whsec_…
```

Jamais dans le dépôt ni dans une conversation : `backend/.env.test.local` (gitignoré, mode 600)
pour les tests, réglages société chiffrés (`CompanyChannelConfig`) en exploitation.
