---
sidebar_position: 5
---

# Serveur MCP

Invoicerr expose un serveur [Model Context Protocol](https://modelcontextprotocol.io) pour que des agents IA (par exemple OpenWebUI) puissent créer des devis, des factures, des clients et des articles directement depuis une conversation, en réutilisant la même couche de service que l'API REST. Pour savoir comment connecter un client et ce que vous pouvez lui demander de faire, voir le [guide utilisateur Agents IA](../user-guide/ai-agents.md).

- **Point de terminaison** : `POST /api/mcp`
- **Transport** : HTTP en flux continu (Streamable HTTP), sans état (un serveur MCP neuf, en mémoire, est construit à chaque requête — il n'y a aucun état de session à gérer ni à expirer)
- **Authentification** : `Authorization: Bearer <api-key>` — les mêmes clés API qu'ailleurs, voir [Authentification](./authentication.md#authentification-par-clé-api)

## Portées des clés API

Chaque clé API a une colonne `scopes: string[]` (`backend/src/modules/api-keys/scopes.ts`). Créez ou modifiez une clé depuis **Paramètres → Clés API** et cochez les portées dont elle a besoin :

| Portée | Accorde |
|---|---|
| `quotes:write` | `create_quote` |
| `invoices:write` | `create_invoice`, `create_invoice_from_quote` |
| `clients:write` | `create_client` |
| `articles:write` | `create_article` |
| `articles:read` | `list_articles` |
| `quotes:read` | `get_quote_pdf` |
| `invoices:read` | `get_invoice_pdf` |
| `clients:read` | `list_clients` |

Une clé sans aucune portée cochée peut quand même s'authentifier, mais `tools/list` renvoie un jeu d'outils vide — inoffensif, mais inutile. Les clés créées avant l'existence des portées ont été rétro-remplies avec les cinq portées afin que les intégrations existantes continuent de fonctionner ; accordez les portées délibérément pour les nouvelles clés plutôt que de compter sur ce défaut.

Les outils qu'une clé ne couvre pas ne se contentent pas d'échouer à l'appel — ils sont totalement absents de `tools/list`, si bien qu'un agent qui planifie une tâche ne voit jamais que ce qu'il peut réellement faire.

## Outils disponibles

| Outil | Portée | Correspond à |
|---|---|---|
| `create_quote` | `quotes:write` | `QuotesService.createQuote` |
| `create_invoice` | `invoices:write` | `InvoicesService.createInvoice` |
| `create_invoice_from_quote` | `invoices:write` | `InvoicesService.createInvoiceFromQuote` |
| `create_client` | `clients:write` | `ClientsService.createClient` |
| `create_article` | `articles:write` | `ArticlesService.create` |
| `list_articles` | `articles:read` | `ArticlesService.findAll` |
| `get_quote_pdf` | `quotes:read` | `QuotesService.getQuotePdf` |
| `get_invoice_pdf` | `invoices:read` | `InvoicesService.getInvoicePdf` |
| `list_clients` | `clients:read` | `ClientsService.searchClients` |

Chaque outil est un adaptateur léger (`backend/src/modules/mcp/tools/*.ts`) — il valide l'entrée face à un schéma zod qui reflète le DTO REST équivalent, appelle le service existant avec le `companyId` de la clé API, et renvoie à la fois un court résumé texte et du contenu structuré (par exemple `{ id, name }`) pour qu'un agent puisse enchaîner des appels (créer un client, puis un devis pour ce client) sans avoir à analyser de la prose.

`list_clients` existe spécifiquement pour que les agents puissent chercher un client existant (par nom, contact ou fragment d'adresse) avant d'appeler `create_client` ou avant de résoudre un `clientId` pour `create_quote`/`create_invoice` — les deux descriptions d'outil orientent l'agent vers cet appel en premier et vers une demande de clarification à l'utilisateur en cas de correspondances ambiguës, même si ceci reste une convention de prompt, pas un ordre d'appel imposé.

Il n'existe pas de piste d'audit séparée « créé via MCP » — les créations apparaissent exactement comme n'importe quel autre changement piloté par clé API (`ApiKey.lastUsedAt`, et les webhooks que le service sous-jacent déclenche déjà à la création).

### Les outils PDF renvoient à la fois un blob intégré et un lien de téléchargement

`get_quote_pdf` et `get_invoice_pdf` renvoient le PDF de deux façons dans le même résultat :

- Un bloc de contenu MCP « resource » encodé en base64 (`{ type: 'resource', resource: { uri, mimeType: 'application/pdf', blob } }`). Le support de rendu côté client pour ce type de contenu est encore en train de mûrir dans l'écosystème — OpenWebUI, par exemple, ne rend pas encore de façon fiable un aperçu PDF à partir de là, il affiche simplement un espace réservé inerte. Le blob est malgré tout renvoyé en entier, si bien qu'un agent (ou un script pilotant le client MCP) peut toujours le décoder et l'utiliser, même là où le client n'affiche aucun aperçu.
- Un `downloadUrl` dans `structuredContent` (et repris dans le bloc texte) — un **lien public, non authentifié, protégé par jeton** (`GET /api/pdf-links/:token`, `@AllowAnonymous()` dans `backend/src/modules/pdf-links/pdf-links.controller.ts`) valable **1 heure**, réutilisable jusqu'à expiration, pas à usage unique. C'est ce qui rend réellement le PDF cliquable/utilisable depuis une interface de chat aujourd'hui : quiconque a le lien peut consulter ce document unique jusqu'à son expiration, sans clé API — le jeton de 256 bits (`PdfLinksService.createToken`, haché au repos avec SHA-256, même raisonnement que `backend/src/utils/api-key.ts`) est le seul contrôle d'accès. Les deux descriptions d'outil demandent à l'agent de présenter `downloadUrl` à l'utilisateur plutôt que de compter sur la visibilité du blob intégré.

Les très grandes factures/devis produisent des payloads base64 proportionnellement volumineux pour le blob intégré (environ 33 % plus gros que le PDF brut) — `downloadUrl` n'a pas ce surcoût puisqu'il diffuse le PDF directement. Si Invoicerr se trouve derrière un reverse proxy, vérifiez ses limites de taille de réponse si des récupérations de blob intégré pour des documents inhabituellement volumineux se mettent à échouer.

## Compatibilité client

Tout client MCP prenant en charge le transport HTTP en flux continu avec un jeton Bearer statique peut se connecter (OpenWebUI est celui qu'Invoicerr documente et teste — voir le [guide utilisateur Agents IA](../user-guide/ai-agents.md)). Les clients dont la seule option d'authentification MCP distante est OAuth (aucun champ de jeton statique) ne peuvent pas être pointés vers ce point de terminaison, puisque le serveur MCP d'Invoicerr ne prend intentionnellement en charge que l'authentification par clé API, pas un serveur d'autorisation OAuth 2.1 complet.
