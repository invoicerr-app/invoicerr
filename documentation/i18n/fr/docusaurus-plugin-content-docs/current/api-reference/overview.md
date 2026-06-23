---
sidebar_position: 1
---

# Référence API

Le backend d'Invoicerr expose une API REST entièrement documentée via [Swagger/OpenAPI](https://swagger.io/), générée à partir des décorateurs `@nestjs/swagger` présents sur chaque contrôleur dans `backend/src/modules/`.

Plutôt que de dupliquer cette référence ici, utilisez l'interface Swagger en direct, toujours à jour, servie par votre propre instance Invoicerr :

- **Interface interactive** : `https://<votre-instance>/api/docs`
- **Spécification OpenAPI brute (JSON)** : `https://<votre-instance>/api/docs-json`

Pour une configuration de développement local (voir [Développement local](../getting-started/local-development.md)), il s'agit généralement de :

- `http://localhost:3000/api/docs`
- `http://localhost:3000/api/docs-json`

## Authentification

La plupart des points de terminaison nécessitent soit un cookie de session (connexion via le navigateur), soit une clé API. Voir [Authentification](../developer-guide/authentication.md) pour le détail des deux mécanismes, et le module `api-keys` pour gérer les clés depuis l'interface.
