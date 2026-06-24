---
sidebar_position: 2
---

# Système de plugins

Invoicerr prend en charge deux types de plugins, tous deux gérés par le module `plugins` (`backend/src/modules/plugins/`).

## Plugins intégrés

Plugins intégrés pour un ensemble fixe de types : `SIGNING`, `STORAGE`, `PDF_FORMAT`, `OIDC`. Ils sont enregistrés au démarrage par un singleton `PluginRegistry` (`backend/src/plugins/index.ts`) et stockés en base de données avec un interrupteur activé/désactivé et un formulaire de configuration optionnel.

- Un seul plugin actif par type, sauf `STORAGE` qui prend en charge plusieurs instances actives.
- Exemples : un fournisseur Documenso pour la signature, un fournisseur S3 pour le stockage.

### Flux d'activation

1. Un utilisateur active/désactive un plugin intégré via `PUT /api/plugins/in-app/toggle`.
2. Si le plugin nécessite une configuration, l'API renvoie un schéma de formulaire et diffère l'activation.
3. L'utilisateur soumet la configuration via `POST /api/plugins/in-app/configure`.
4. Le système valide le plugin, génère une URL/un secret de webhook si le plugin implémente `handleWebhook()`, et persiste le tout.

## Plugins externes

Plugins basés sur Git que les utilisateurs installent par URL :

1. Un utilisateur clone un dépôt de plugin via `POST /api/plugins` avec une URL Git.
2. Le système charge le point d'entrée JS du plugin et instancie son export par défaut.
3. Le plugin est enregistré en mémoire avec un UUID et un nom, avec un hook d'initialisation optionnel.

## Interface de plugin

Définie dans `backend/src/plugins/types.ts`. Chaque plugin implémente `IPlugin` (`id`, `name`, `validatePlugin()` optionnel, `handleWebhook()` optionnel). Les fournisseurs de signature implémentent en plus des hooks de génération de signature/PDF.

## Webhooks entrants de plugins

Des services externes (p. ex. un fournisseur de signature finalisant une signature) rappellent via `POST /api/webhooks/:pluginId`, un point de terminaison anonyme. Le système vérifie que le plugin existe et est actif, puis transmet la requête à l'implémentation `handleWebhook()` du plugin.
