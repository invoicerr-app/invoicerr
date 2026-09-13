---
sidebar_position: 8
---

# Agents IA

Connectez Invoicerr à un assistant de conversation IA (comme [OpenWebUI](https://openwebui.com)) pour créer des devis, des factures, des clients et des articles — ou récupérer la copie PDF de l'un d'eux — simplement en le demandant, sans quitter la conversation.

## Ce que vous pouvez lui demander de faire

- *« Crée un client nommé Acme Corp, 12 Rue de la Paix, Paris. »*
- *« Fais un devis pour Acme Corp avec une ligne : Refonte du site web, 2 500 €, TVA 20 %. »*
- *« Transforme le devis #Q-2026-0042 en facture. »*
- *« Ajoute un article au catalogue : Hébergement mensuel, 49 €, TVA 20 %. »*
- *« Donne-moi le PDF de la facture #INV-2026-0018. »*

L'assistant ne voit que les actions que sa clé API l'autorise à effectuer (voir **Permissions** ci-dessous) — s'il ne peut pas faire quelque chose, il ne le proposera tout simplement pas.

Si vous lui demandez de créer un devis ou une facture pour un client qui existe déjà, il le recherche d'abord au lieu d'en créer un doublon — et s'il trouve plusieurs clients qui pourraient correspondre, il vous demandera lequel vous voulez dire avant de faire quoi que ce soit.

## Mise en place

### 1. Créer une clé API avec les bonnes permissions

Allez dans **Paramètres → Compte & équipe → Clés API**, créez une nouvelle clé, et cochez les permissions que vous voulez accorder à l'assistant :

- **Créer des devis** / **Créer des factures** / **Créer des clients** / **Créer des articles** — lui permet d'ajouter de nouveaux enregistrements pour vous
- **Lire les articles** — lui permet de consulter votre catalogue existant
- **Lire les clients** — lui permet de consulter vos clients existants avant d'en créer un nouveau (évite les doublons)
- **Lire les devis** / **Lire les factures** — lui permet de récupérer la copie PDF d'un devis ou d'une facture

N'accordez que ce que vous voulez réellement voir un assistant faire : vous pouvez toujours revenir plus tard ajuster les permissions d'une clé. Copiez la clé quelque part en sécurité — elle n'est affichée qu'une seule fois.

### 2. La connecter à OpenWebUI

1. Dans OpenWebUI, allez dans **Admin Settings → Integrations → External Tool Servers → +**
2. Réglez **Type** sur **MCP (Streamable HTTP)** (la valeur par défaut est « OpenAPI » — changez-la)
3. **URL** : `https://<votre-domaine-invoicerr>/api/mcp`
4. **Auth** : **Bearer**, puis collez votre clé API
5. Donnez-lui un nom et enregistrez

Une fois connecté, activez le serveur d'outils pour une conversation (le « + » à côté de la zone de message, ou définissez-le par défaut pour un modèle dans **Workspace → Models**) et commencez à lui demander.

## Bon à savoir

- Récupérer un PDF vous donne aussi un lien direct, valable **1 heure**, que vous pouvez ouvrir vous-même même si l'application de chat n'affiche pas d'aperçu intégré — aucune connexion nécessaire pour l'ouvrir, ne le partagez simplement avec personne à qui vous ne voulez pas montrer ce document.
- Tout ce que l'assistant crée apparaît dans Invoicerr exactement comme tout ce qui est créé depuis l'application elle-même — même numérotation, mêmes webhooks, même piste d'audit (« Dernière utilisation de la clé API » dans les Paramètres).
