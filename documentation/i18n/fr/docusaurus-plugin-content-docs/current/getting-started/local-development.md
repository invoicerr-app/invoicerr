---
sidebar_position: 3
---

# Installation manuelle (développement local)

## Prérequis

- Node.js v20+
- SQLite (ou configurez une autre `DATABASE_URL`)
- npm

## Étapes

1. Clonez le projet :

   ```bash
   git clone https://github.com/invoicerr-app/invoicerr.git
   cd invoicerr
   ```

2. Configuration du backend :

   ```bash
   cd backend
   npm install
   npx prisma generate
   npm run start
   ```

3. Configuration du frontend, dans un nouveau terminal :

   ```bash
   cd frontend
   npm install
   npm run start
   ```

4. Ouvrez dans votre navigateur :
   - Frontend : `http://localhost:5173`
   - API : `http://localhost:3000`

## Lancer les tests end-to-end (Cypress)

1. Démarrez le backend et le frontend avec les variables d'environnement de test :

   ```bash
   cd backend && npm run start:test &
   cd frontend && npm run start:test &
   ```

   Assurez-vous d'avoir un fichier `.env.test` dans chaque dossier.

2. Dans un autre terminal, lancez Cypress :

   ```bash
   cd e2e
   npm install
   npm run e2e:open # ou npm run e2e:run
   ```

En CI, le workflow GitHub Actions exécute ces étapes automatiquement.
