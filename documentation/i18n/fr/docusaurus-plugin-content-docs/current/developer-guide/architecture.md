---
sidebar_position: 1
---

# Architecture du backend

Le backend (`backend/`) est une application NestJS organisée en modules fonctionnels sous `backend/src/modules/`. Chaque module possède généralement son propre contrôleur, service et DTO, et la plupart des services injectent le dispatcher de webhooks pour émettre des événements lors des changements d'état (voir [Système de webhooks](./webhooks.md)).

## Modules

| Module | Rôle |
| --- | --- |
| `api-keys` | CRUD et vérification des clés API ; stocke un hash et suit la date de dernière utilisation. |
| `auth-extended` | Étend la bibliothèque d'authentification avec la gestion des mots de passe, p. ex. permettre aux utilisateurs OIDC de définir un mot de passe local. |
| `clients` | Gère les fiches clients. |
| `company` | Gère le profil de l'entreprise, l'image de marque des PDF (couleurs, polices) et les modèles d'e-mail. |
| `cron` | Tâches planifiées en arrière-plan. |
| `danger` | Opérations sensibles nécessitant une vérification par OTP (p. ex. suppression de compte). |
| `dashboard` | Agrège les indicateurs clés : totaux de factures, tendances de revenus, statuts de devis, nombre de clients. |
| `directory` | Navigateur de fichiers restreint utilisé pour la sélection de fichiers de plugins/config. |
| `invitations` | Crée et valide des codes d'invitation pour l'inscription multi-utilisateurs. |
| `invoices` | CRUD des factures, génération PDF/XML, suivi des paiements, lignes d'articles. |
| `logger` | Flux d'événements (server-sent events) de logs en temps réel, filtrable par catégorie/niveau/utilisateur. |
| `payment-methods` | Stocke et active/désactive les moyens de paiement, rattachés aux factures/devis. |
| `plugins` | Registre et chargeur des plugins intégrés et externes. Voir [Système de plugins](./plugin-system.md). |
| `quotes` | CRUD des devis, génération PDF, flux de signature, suivi d'expiration. |
| `receipts` | Génération de reçus à partir des factures, PDF, envoi par e-mail. |
| `recurring-invoices` | Génération planifiée de factures de façon récurrente. |
| `signatures` | Fait le lien avec le flux de signature des devis pour les signataires anonymes. |
| `stats` | Statistiques financières mensuelles/annuelles. |
| `webhooks` | Abonnements aux webhooks définis par l'utilisateur et envoi d'événements vers des points de terminaison externes. |

## Couche de données

Le backend utilise [Prisma](https://www.prisma.io/) comme ORM, avec le schéma défini dans `backend/prisma/schema.prisma`. SQLite est la base par défaut pour les installations locales/Docker ; PostgreSQL est pris en charge via `DATABASE_URL`.

## Documentation de l'API

Le backend expose une interface Swagger/OpenAPI en direct sur `/api/docs` (spécification JSON sur `/api/docs-json`), générée à partir des décorateurs `@nestjs/swagger` sur chaque contrôleur. Voir la page [Référence API](api-reference.md).
