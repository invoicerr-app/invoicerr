# TODO - Système Multi-Tenant de Facturation Dynamique

> **Projet**: Implémentation du système multi-tenant pour Invoicerr
> **Architecture**: Basée sur /docs/compliance/ARCHITECTURE.md
> **Date**: Février 2026

---

## Phase 1: Exploration (Agents Front & Back)

### Agent Frontend (exploration-frontend)
- [ ] Analyser la structure actuelle du frontend
- [ ] Identifier les composants à migrer en multi-tenant
- [ ] Comprendre l'authentification (Better Auth)
- [ ] Identifier les stores/contexts nécessaires pour le multi-tenant
- [ ] **Important**: Activer les skills `vercel-react-best-practices`, `tailwind-v4-shadcn`

### Agent Backend (exploration-backend)
- [ ] Analyser la structure actuelle du backend NestJS
- [ ] Identifier les modules à migrer en multi-tenant
- [ ] Analyser le schéma Prisma actuel
- [ ] Comprendre le module compliance détaillé dans ARCHITECTURE.md
- [ ] **Important**: Activer les skills `nestjs-best-practices`, `prisma-expert`, `modular-architecture`

---

## Phase 2: Orchestration (Agent Principal)

### Agent Orchestrateur
- [ ] Recevoir les rapports des agents d'exploration
- [ ] Planifier les tâches pour chaque agent spécialisé
- [ ] Coordonner l'ordre des implémentations
- [ ] S'assurer de la cohérence entre front, back et DB

---

## Phase 3: Implémentation Multi-Tenant

### 3.1 Base de Données (Agent DB)
- [ ] Ajouter le modèle `Tenant` dans Prisma
- [ ] Ajouter `tenantId` aux modèles existants
- [ ] Créer les relations entre Tenant et:
  - Users
  - Companies
  - Invoices
  - Quotes
  - Clients
  - Settings
- [ ] Générer et appliquer la migration
- [ ] **Skill recommandée**: `prisma-expert`, `prisma-migration-assistant`

### 3.2 Backend (Agent Backend)
- [ ] Créer le module `tenant`
- [ ] Implémenter `TenantGuard` pour l'isolation des données
- [ ] Créer `TenantInterceptor` pour extraire le tenant du contexte
- [ ] Modifier tous les services pour filtrer par tenant
- [ ] Adapter le module compliance pour supporter le multi-tenant
- [ ] Mettre à jour les repositories Prisma

### 3.3 Frontend (Agent Frontend)
- [ ] Créer le context `TenantContext`
- [ ] Ajouter le sélecteur de tenant dans l'UI
- [ ] Mettre à jour les hooks de données pour inclure le tenant
- [ ] Adapter les formulaires (création/édition de tenant)
- [ ] Modifier les appels API pour inclure l'header `X-Tenant-ID`

---

## Phase 4: Migration Données

- [ ] Script de migration pour assigner les données existantes à un tenant
- [ ] Vérifier la cohérence des données après migration
- [ ] Tests de régression

---

## Phase 5: Tests et Validation

- [ ] Tests unitaires backend
- [ ] Tests E2E avec Cypress
- [ ] Vérifier l'isolation entre tenants
- [ ] Tester la génération de PDF multi-tenant
- [ ] Tester l'envoi d'emails

---

## Règles Importantes

1. **Pas de fournisseur de paiement** - Seulement devis, factures, envoi
2. **Supprimer le code existant** si nécessaire pour le multi-tenant
3. **Commits fréquents** avec messages clairs (format gitmoji)
4. **Ne PAS commiter ce fichier TODO.md**
5. **Activer les skills** appropriées avant de coder
6. **Suivre ARCHITECTURE.md** pour le module compliance

---

## Architecture Multi-Tenant Cible

```
┌─────────────────────────────────────────────────────┐
│                    CLIENT                           │
│  ┌─────────────────┐    ┌──────────────────────┐   │
│  │ Tenant Selector │    │  Application Routes   │   │
│  └─────────────────┘    └──────────────────────┘   │
└────────────────────┬────────────────────────────────┘
                     │ X-Tenant-ID Header
┌────────────────────▼────────────────────────────────┐
│                    BACKEND                          │
│  ┌──────────────────────────────────────────────┐  │
│  │         TenantGuard / Interceptor            │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │  Auth    │ │ Invoices │ │  Compliance      │   │
│  │ Module   │ │ Module   │ │  Module          │   │
│  └──────────┘ └──────────┘ └──────────────────┘   │
└────────────────────┬────────────────────────────────┘
                     │ tenantId filter
┌────────────────────▼────────────────────────────────┐
│                 DATABASE                            │
│  ┌──────────────────────────────────────────────┐  │
│  │  tenants (id, name, settings, createdAt)     │  │
│  │  users (..., tenantId)                       │  │
│  │  companies (..., tenantId)                   │  │
│  │  invoices (..., tenantId)                    │  │
│  │  quotes (..., tenantId)                      │  │
│  │  clients (..., tenantId)                     │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

*Ce fichier doit rester dans .gitignore*
