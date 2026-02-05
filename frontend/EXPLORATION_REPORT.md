# Rapport d'Exploration Frontend - Système Multi-Tenant

**Date:** 2026-02-04  
**Projet:** Invoicerr - Application de facturation pour freelances  
**Agent:** Exploration Frontend Agent

---

## 1. Structure du Projet Identifiée

### 1.1 Architecture Générale

```
frontend/src/
├── assets/              # Assets statiques (images, fonts)
├── components/          # Composants réutilisables
│   ├── ui/             # Composants shadcn/ui de base
│   └── icons/          # Icônes personnalisées
├── constants/          # Constantes globales (currencies, etc.)
├── contexts/           # Contextes React
│   ├── company.tsx     # Contexte multi-company (CLÉ)
│   └── theme.tsx       # Contexte de thème
├── hooks/              # Custom hooks
│   ├── use-fetch.ts    # Hooks de requêtes API
│   ├── use-compliance.ts # Hooks compliance/pays
│   └── use-mobile.ts   # Détection mobile
├── lib/                # Utilitaires et configurations
│   ├── auth.ts         # Configuration Better Auth
│   ├── i18n.ts         # Configuration i18n
│   └── utils.ts        # Fonctions utilitaires
├── locales/            # Fichiers de traduction (16 langues)
├── pages/              # Pages (routing Generouted)
│   ├── (app)/          # Routes protégées (layout authentifié)
│   │   ├── _layout.tsx # Layout principal avec CompanyProvider
│   │   ├── dashboard.tsx
│   │   ├── clients/
│   │   ├── invoices/
│   │   ├── quotes/
│   │   ├── receipts/
│   │   ├── payment-methods/
│   │   ├── settings/
│   │   ├── stats.tsx
│   │   └── admin/      # Section admin système
│   ├── auth/           # Routes d'authentification
│   ├── invitation/     # Invitations
│   └── index.tsx       # Page d'accueil
├── types/              # Types TypeScript
│   ├── company.ts
│   ├── invoice.ts
│   ├── quote.ts
│   ├── receipt.ts
│   ├── client.ts
│   ├── user.ts
│   └── payment-method.ts
└── utils/              # Utilitaires métier
```

### 1.2 Stack Technique

| Technologie | Version | Usage |
|-------------|---------|-------|
| React | 19.1.0 | Framework UI |
| Vite | 7.2.7 | Build tool |
| React Router | 7.12.0 | Routing |
| Generouted | 1.20.0 | Routing file-based |
| Tailwind CSS | 4.1.11 | Styling |
| shadcn/ui | - | Composants UI |
| Better Auth | 1.4.5 | Authentification |
| react-i18next | 15.5.3 | Internationalisation |
| react-hook-form | 7.58.1 | Formulaires |
| Zod | 3.25.67 | Validation |
| Recharts | 3.0.2 | Graphiques |

---

## 2. Système Multi-Company Existant

### 2.1 Contexte Company Déjà Implémenté

Le projet dispose déjà d'un **système multi-company robuste**:

**Fichier clé:** `/frontend/src/contexts/company.tsx`

```typescript
interface CompanyContextValue {
  companies: UserCompany[];           // Liste des companies de l'utilisateur
  activeCompanyId: string | null;     // ID de la company active
  activeCompany: Company | null;      // Détails de la company active
  isLoading: boolean;
  switchCompany: (companyId: string) => void;  // Changer de company
  refreshCompanies: () => Promise<void>;
  setActiveCompanyDirect: (company: Company) => void;
}
```

**Stockage:**
- `localStorage` - Clé: `invoicerr_active_company_id`
- Header HTTP injecté automatiquement: `X-Company-Id`

### 2.2 Composant CompanySwitcher

**Fichier:** `/frontend/src/components/company-switcher.tsx`

- Dropdown dans la sidebar
- Affiche la company active
- Permet de switcher entre companies
- Bouton "Créer nouvelle company"

### 2.3 Hook de Requêtes API

**Fichier:** `/frontend/src/hooks/use-fetch.ts`

Le hook `authenticatedFetch` injecte automatiquement le header `X-Company-Id`:

```typescript
export async function authenticatedFetch(
  input: RequestInfo,
  init: RequestInit = {},
): Promise<Response> {
  const activeCompanyId = getActiveCompanyId();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };

  // Add company ID header if available
  if (activeCompanyId) {
    (headers as Record<string, string>)['X-Company-Id'] = activeCompanyId;
  }
  // ...
}
```

---

## 3. Architecture de Routing (Generouted)

### 3.1 Routes Définies

```typescript
export type Path =
  | `/`                    // Landing page
  | `/admin`               // Admin système
  | `/admin/companies`
  | `/admin/users`
  | `/auth/sign-in`
  | `/auth/sign-out`
  | `/auth/sign-up`
  | `/clients`             // Gestion clients
  | `/dashboard`           // Tableau de bord
  | `/invitation/:code`    // Acceptation invitation
  | `/invoices`            // Gestion factures
  | `/invoices/:id/corrective`
  | `/invoices/:id/credit-note`
  | `/invoices/:id/void-reissue`
  | `/payment-methods`     // Moyens de paiement
  | `/quotes`              // Gestion devis
  | `/receipts`            // Gestion reçus
  | `/settings/:tab?`      // Paramètres (multi-tabs)
  | `/signature/:id`       // Signature documents
  | `/stats`;              // Statistiques
```

### 3.2 Layouts

**Layout Authentifié** (`/frontend/src/pages/(app)/_layout.tsx`):
- Vérifie la session via `authClient.useSession()`
- Englobe avec `CompanyProvider`
- Affiche la sidebar et le contenu principal

---

## 4. Points d'Intégration Multi-Tenant

### 4.1 Déjà en Place (Multi-Company)

| Composant | Contexte | Description |
|-----------|----------|-------------|
| `CompanyProvider` | Global | Fournit le contexte company à toute l'app |
| `CompanySwitcher` | Sidebar | UI de sélection/changement de company |
| `authenticatedFetch` | HTTP | Injecte le header X-Company-Id |
| `OnBoarding` | Modal | Création de la première company |

### 4.2 Composants Utilisant le Contexte Company

Tous les composants dans `pages/(app)/` ont accès au contexte company via:

```typescript
import { useCompany } from '@/contexts/company';

const { activeCompany, activeCompanyId, isLoading } = useCompany();
```

**Pages concernées:**
- `/dashboard` - Affiche les stats de la company active
- `/clients` - Liste les clients de la company active
- `/invoices` - Liste les factures de la company active
- `/quotes` - Liste les devis de la company active
- `/receipts` - Liste les reçus de la company active
- `/payment-methods` - Moyens de paiement de la company
- `/settings/company` - Configuration de la company active
- `/stats` - Statistiques de la company

### 4.3 Structure des Données Liées à la Company

**Type Company** (`/frontend/src/types/company.ts`):

```typescript
export interface Company {
  id: string;
  name: string;
  description: string;
  currency: string;
  identifiers: Record<string, string>;  // SIRET, TVA, etc.
  address: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  // Configuration des numéros
  quoteStartingNumber: number;
  quoteNumberFormat: string;
  invoiceStartingNumber: number;
  invoiceNumberFormat: string;
  receiptStartingNumber: number;
  receiptNumberFormat: string;
  // Configuration PDF
  invoicePDFFormat: string;
  dateFormat: string;
  exemptVat?: boolean;
}
```

---

## 5. Recommandations pour le Multi-Tenant

### 5.1 État Actuel

Le système est déjà **multi-company** fonctionnel. Chaque utilisateur peut:
- Appartenir à plusieurs companies
- Créer de nouvelles companies
- Switcher entre companies
- Avoir des rôles différents par company

### 5.2 Pour Renforcer l'Isolation Multi-Tenant

#### Option 1: URL-based Tenant (Recommandé pour SaaS)

**Modifications nécessaires:**

1. **Router** - Ajouter une route dynamique:
   ```typescript
   // routes: /:tenantId/dashboard, /:tenantId/invoices, etc.
   export type Path =
     | `/:tenantId/dashboard`
     | `/:tenantId/invoices`
     | // ...
   ```

2. **CompanyProvider** - Extraire le tenantId de l'URL:
   ```typescript
   const { tenantId } = useParams();
   ```

3. **Middleware** - Redirection si company non accessible

#### Option 2: Garder le Système Actuel (Header-based)

Le système actuel est déjà robuste pour un usage "workspace":
- Header `X-Company-Id` pour l'isolation API
- localStorage pour la persistance
- CompanyProvider pour le contexte React

### 5.3 Fichiers à Modifier pour Renforcement Multi-Tenant

| Fichier | Modification | Priorité |
|---------|--------------|----------|
| `contexts/company.tsx` | Ajouter validation tenant | Haute |
| `hooks/use-fetch.ts` | Ajouter intercepteur erreurs 403 | Moyenne |
| `components/company-switcher.tsx` | Afficher rôle utilisateur | Basse |
| `pages/(app)/_layout.tsx` | Ajouter guard tenant | Haute |

### 5.4 Sécurité à Ajouter

```typescript
// Dans contexts/company.tsx - Validation du tenant
useEffect(() => {
  if (activeCompanyId && !companies.find(c => c.companyId === activeCompanyId)) {
    // L'utilisateur n'a plus accès à cette company
    localStorage.removeItem(STORAGE_KEY);
    setActiveCompanyId(null);
    toast.error('Accès à cette company révoqué');
  }
}, [activeCompanyId, companies]);
```

---

## 6. Dépendances Identifiées

### 6.1 Dépendances Clés

```json
{
  "better-auth": "^1.4.5",          // Authentification JWT
  "@generouted/react-router": "^1.20.0",  // Routing
  "react-router": "^7.12.0",        // Navigation
  "zustand": "non installé",        // State management (optionnel)
}
```

### 6.2 Architecture State Management Actuelle

- **Global:** Context API (CompanyProvider, ThemeProvider)
- **Local:** useState, useReducer
- **Server:** React Query-like via use-fetch.ts (custom)
- **Form:** react-hook-form

### 6.3 Aucune Dépendance de Paiement

Conformément aux contraintes, **aucun fournisseur de paiement** n'est présent:
- Pas de Stripe
- Pas de PayPal
- Pas de LemonSqueezy

Seules les fonctionnalités devis/factures/envoi sont implémentées.

---

## 7. Points de Vigilance

### 7.1 Code à Ne Pas Modifier

| Fichier | Raison |
|---------|--------|
| `router.ts` | Généré automatiquement par Generouted |
| `components/ui/*` | Composants shadcn/ui standard |

### 7.2 Conventions de Code

- **Biome** pour linting/formatting (pas ESLint/Prettier)
- **TypeScript strict** activé
- **Tailwind CSS v4** avec classes utilitaires
- **i18n** - 16 langues supportées

### 7.3 Variables d'Environnement

```
VITE_BACKEND_URL=http://localhost:3000
```

---

## 8. Conclusion

### 8.1 Synthèse

Le frontend Invoicerr dispose déjà d'une **architecture multi-company mature**:

- Contexte Company global avec persistance localStorage
- Injection automatique du header X-Company-Id
- UI de switch de company dans la sidebar
- Hook useCompany() accessible partout
- Validation des permissions côté backend (via le header)

### 8.2 Prêt pour Multi-Tenant

Le système actuel est **déjà multi-tenant** au niveau application. Pour une architecture SaaS pure avec sous-domaines (tenant1.invoicerr.app), il faudrait:

1. Ajouter le tenantId dans les URLs
2. Modifier CompanyProvider pour lire l'URL
3. Ajouter des guards de sécurité

Mais pour une utilisation "workspace" classique (comme Notion, Figma), le système actuel est **parfaitement adapté**.

### 8.3 Prochaines Étapes Recommandées

1. **Audit sécurité** - Vérifier toutes les routes API utilisent bien le header X-Company-Id
2. **Tests E2E** - Scénarios de changement de company
3. **Optimisation** - React Query pour le cache des données company
4. **Documentation** - Guide utilisateur du multi-company

---

**Fin du rapport**
