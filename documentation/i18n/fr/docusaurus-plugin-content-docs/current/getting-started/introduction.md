---
sidebar_position: 1
---

# Introduction

Invoicerr est une application de facturation open-source et simple, conçue pour aider les freelances à gérer efficacement leurs devis et leurs factures. Elle offre une interface claire pour créer, envoyer et suivre devis et factures.

## Fonctionnalités

- Créer et gérer des factures
- Créer et gérer des devis (convertibles en factures)
- Gérer les clients et leurs coordonnées
- Suivre le statut des devis et des factures (signé, payé, non lu, etc.)
- Système de signature de devis intégré avec des jetons sécurisés
- Générer et envoyer des e-mails de devis/facture directement depuis l'application
- Générer des documents PDF soignés (devis, factures, reçus, et plus)
- Identité de marque personnalisée : logo, nom de l'entreprise, TVA, et plus
- Authentification via JWT ou OIDC (stockée dans des cookies)
- Pensé pour l'international : interface en anglais par défaut, devises personnalisables
- Base de données SQLite ou PostgreSQL
- Prêt pour Docker & docker-compose pour l'auto-hébergement
- Construit sur une stack moderne : React, NestJS, Prisma
- Backend en API REST, prêt pour de futures intégrations (applications mobiles & desktop)
- Système de plugins pour les fonctionnalités créées par la communauté

## Stack technique

- **Frontend** : React, TypeScript, Vite, TailwindCSS
- **Backend** : NestJS, TypeScript, Prisma
- **Base de données** : SQLite (par défaut) ou PostgreSQL
- **Conteneurisation** : Docker & Docker Compose

## Licence

Invoicerr est sous double licence :
- Open source sous [AGPL-3.0](https://github.com/invoicerr-app/invoicerr/blob/main/LICENSE)
- Licence commerciale disponible pour un usage propriétaire — voir la [COMMERCIAL-LICENSE](https://github.com/invoicerr-app/invoicerr/blob/main/COMMERCIAL-LICENSE)
