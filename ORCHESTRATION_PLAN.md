# Plan d'Orchestration - Système Multi-Tenant Invoicerr

**Date de création:** 2026-02-04  
**Orchestrateur:** Agent Principal  
**Statut:** PRÊT POUR EXÉCUTION

---

## 1. Résumé de l'État Actuel

### 1.1 Système Multi-Tenant - DÉJÀ IMPLÉMENTÉ ✅

Le projet Invoicerr dispose d'une **architecture multi-tenant mature et complète** :

#### Backend (NestJS + Prisma)
- **Architecture:** Shared Database with TenantID
- **Guard Global:** `CompanyGuard` déjà appliqué via `APP_GUARD`
- **Isolation:** Toutes les entités filtrent par `companyId`
- **Relations:** User-Company avec rôles (SYSTEM_ADMIN, OWNER, ADMIN, ACCOUNTANT)
- **Soft Delete:** Implémenté via `isActive`

#### Frontend (React + Generouted)
- **Contexte Global:** `CompanyProvider` avec persistance localStorage
- **Header HTTP:** `X-Company-Id` injecté automatiquement
- **UI de Switch:** `CompanySwitcher` dans la sidebar
- **Hook:** `useCompany()` accessible dans toute l'app

#### Module Compliance
- **Architecture:** Très sophistiquée avec pattern Strategy
- **Services:** VAT Engine, Context Builder, Rule Resolver
- **Documents:** Générateurs PDF/XML (Factur-X, UBL, FatturaPA)
- **Formats:** Générateurs XML prêts
- **Transmission:** Infrastructure prête, stratégies à implémenter

### 1.2 Écarts Identifiés

| Composant | Statut | Priorité |
|-----------|--------|----------|
| Configs pays spécifiques | ⚠️ Manquantes | Haute |
| Stratégies transmission | ⚠️ Email seule | Haute |
| CompanySwitcher UX | ⚠️ Basique | Moyenne |
| Tests multi-tenant | ❌ Absents | Haute |

---

## 2. Plan d'Exécution par Agent

### Phase 1: Fondations Backend (Jours 1-3)
**Agent Backend** - Skill: `nestjs-best-practices`, `prisma-expert`

#### 2.1.1 Configurations Pays

**Fichiers à créer:**
```
backend/src/modules/compliance/configs/countries/
├── fr.config.ts    # France (Chorus, SuperPDP, Peppol)
├── de.config.ts    # Allemagne (ZUGFeRD, XRechnung, Peppol)
├── it.config.ts    # Italie (FatturaPA, SDI)
├── es.config.ts    # Espagne (Verifactu, hash chain)
├── pt.config.ts    # Portugal (SAF-T, QR code)
```

**Tâches détaillées:**

1. **France (fr.config.ts)**
   - [ ] TVA: Taux 20%, 10%, 5.5%, 2.1%
   - [ ] Identifiants: SIRET, SIREN, TVA FR
   - [ ] Transmission B2G: Chorus (model: 'pdp', mandatory: true depuis 2020)
   - [ ] Transmission B2B: PDP (model: 'pdp', mandatory depuis 2026)
   - [ ] Format: Factur-X/ZUGFeRD (CII)
   - [ ] Numérotation: Séries autorisées, reset annuel optionnel
   - [ ] Mentions légales: TVA, SIRET, conditions de règlement
   - [ ] Peppol: schemeId '0009'
   - [ ] Archivage: 10 ans

2. **Allemagne (de.config.ts)**
   - [ ] TVA: Taux 19%, 7%
   - [ ] Identifiants: Steuernummer, USt-IdNr
   - [ ] Transmission B2G: Peppol (model: 'peppol', mandatory)
   - [ ] Transmission B2B: Peppol recommandé
   - [ ] Format: XRechnung (UBL), ZUGFeRD (CII)
   - [ ] Numérotation: Continue obligatoire
   - [ ] Mentions légales: USt-IdNr, Steuernummer
   - [ ] Peppol: schemeId '9930' (GLN)
   - [ ] Archivage: 10 ans

3. **Italie (it.config.ts)**
   - [ ] TVA: Taux 22%, 10%, 5%, 4%
   - [ ] Identifiants: Partita IVA, Codice Fiscale
   - [ ] Transmission: Clearance (model: 'clearance', mandatory)
   - [ ] Platform: SDI (Sistema di Interscambio)
   - [ ] Format: FatturaPA XML
   - [ ] Numérotation: Numéros attribués par SDI
   - [ ] Signature: XAdES obligatoire
   - [ ] Clearance config: assignsInvoiceNumber: true
   - [ ] Archivage: 10 ans

4. **Espagne (es.config.ts)**
   - [ ] TVA: Taux 21%, 10%, 4%
   - [ ] Identifiants: NIF/CIF
   - [ ] Transmission: Real-time reporting (model: 'rttr')
   - [ ] Platform: Verifactu
   - [ ] Format: Facturae
   - [ ] Hash chain: Obligatoire (SHA-256)
   - [ ] QR Code: Requis sur factures
   - [ ] Signature: XAdES
   - [ ] Archivage: 4 ans minimum

5. **Portugal (pt.config.ts)**
   - [ ] TVA: Taux 23%, 13%, 6%
   - [ ] Identifiants: NIF
   - [ ] Transmission: Hash chain (model: 'hash_chain')
   - [ ] Platform: SAF-T
   - [ ] Format: SAF-T PT
   - [ ] Hash chain: SHA-1 (pour compatibilité)
   - [ ] QR Code: ATCUD obligatoire
   - [ ] Numérotation: Séries uniques
   - [ ] Archivage: 10 ans

**Points de synchronisation:**
- Valider chaque config avec l'orchestrateur avant passage à la suivante
- Tester avec `ComplianceService.getConfig()`

#### 2.1.2 Enregistrement des Configs

**Fichier:** `backend/src/modules/compliance/configs/index.ts`

```typescript
import { frConfig } from './countries/fr.config';
import { deConfig } from './countries/de.config';
import { itConfig } from './countries/it.config';
import { esConfig } from './countries/es.config';
import { ptConfig } from './countries/pt.config';

const configs: Record<string, CountryConfig> = {
  FR: frConfig,
  DE: deConfig,
  IT: itConfig,
  ES: esConfig,
  PT: ptConfig,
};
```

---

### Phase 2: Stratégies de Transmission (Jours 4-7)
**Agent Backend** - Skill: `webhook-integration`, `api-security-best-practices`

#### 2.2.1 Stratégies à Implémenter

**Fichiers à créer:**
```
backend/src/modules/compliance/transmission/strategies/
├── chorus.strategy.ts       # France B2G
├── peppol.strategy.ts       # Réseau Peppol (DE, NL, BE...)
├── sdi.strategy.ts          # Italie SDI
└── verifactu.strategy.ts    # Espagne Verifactu
```

**Tâches détaillées:**

1. **ChorusStrategy (France B2G)**
   ```typescript
   @Injectable()
   export class ChorusStrategy implements TransmissionStrategy {
     readonly name = 'chorus';
     readonly supportedPlatforms = ['chorus'];
     
     // API Chorus Pro
     // Authentification: OAuth2
     // Endpoints: /cpro/...
     // Format: Factur-X
   }
   ```
   - [ ] Configuration OAuth2 (client credentials)
   - [ ] Endpoint de soumission
   - [ ] Polling statut (async_poll)
   - [ ] Gestion des codes erreur Chorus
   - [ ] Tests unitaires

2. **PeppolStrategy**
   ```typescript
   @Injectable()
   export class PeppolStrategy implements TransmissionStrategy {
     readonly name = 'peppol';
     readonly supportedPlatforms = ['peppol'];
     
     // Via Access Point (AP)
     // Format: UBL BIS 3.0
     // Lookup SMP pour destinataire
   }
   ```
   - [ ] Intégration avec AP (Access Point) - mock d'abord
   - [ ] Lookup SMP (Service Metadata Publisher)
   - [ ] Génération UBL BIS 3.0
   - [ ] Tests unitaires

3. **SdIStrategy (Italie)**
   ```typescript
   @Injectable()
   export class SdIStrategy implements TransmissionStrategy {
     readonly name = 'sdi';
     readonly supportedPlatforms = ['sdi'];
     
     // SDI (Sistema di Interscambio)
     // Authentification: Certificat
     // Format: FatturaPA XML signé
   }
   ```
   - [ ] Configuration certificat
   - [ ] Signature XAdES
   - [ ] Endpoint SDI (SDICoop/SDIFtp)
   - [ ] Gestion des notifications (accettazione, rifiuto)
   - [ ] Tests unitaires

4. **VerifactuStrategy (Espagne)**
   ```typescript
   @Injectable()
   export class VerifactuStrategy implements TransmissionStrategy {
     readonly name = 'verifactu';
     readonly supportedPlatforms = ['verifactu'];
     
     // Veri*Factu
     // Hash chaining
     // Format: JSON/XML
   }
   ```
   - [ ] Calcul hash chaîne
   - [ ] Endpoint AEAT (Agencia Tributaria)
   - [ ] Gestion QR code
   - [ ] Tests unitaires

#### 2.2.2 Enregistrement des Stratégies

**Fichier:** `backend/src/modules/compliance/compliance.module.ts`

```typescript
@Module({
  providers: [
    // ... existing providers
    ChorusStrategy,
    PeppolStrategy,
    SdIStrategy,
    VerifactuStrategy,
    {
      provide: 'TRANSMISSION_STRATEGIES',
      useFactory: (
        email: EmailTransmissionStrategy,
        chorus: ChorusStrategy,
        peppol: PeppolStrategy,
        sdi: SdIStrategy,
        verifactu: VerifactuStrategy,
      ) => [email, chorus, peppol, sdi, verifactu],
      inject: [
        EmailTransmissionStrategy,
        ChorusStrategy,
        PeppolStrategy,
        SdIStrategy,
        VerifactuStrategy,
      ],
    },
  ],
})
```

#### 2.2.3 Mise à jour du TransmissionService

**Fichier:** `backend/src/modules/compliance/transmission/transmission.service.ts`

```typescript
@Injectable()
export class TransmissionService {
  constructor(
    @Inject('TRANSMISSION_STRATEGIES')
    private readonly strategies: TransmissionStrategy[],
  ) {}
  // ... existing code
}
```

**Points de synchronisation:**
- Informer l'orchestrateur après chaque stratégie implémentée
- Démonstration avec `TransmissionService.getAvailableStrategies()`

---

### Phase 3: Améliorations Frontend (Jours 3-6, parallèle)
**Agent Frontend** - Skill: `vercel-react-best-practices`, `tailwind-v4-shadcn`

#### 2.3.1 CompanySwitcher Amélioré

**Fichier:** `frontend/src/components/company-switcher.tsx`

**Améliorations:**
- [ ] Afficher le rôle utilisateur dans chaque company
- [ ] Badge "Default" sur la company par défaut
- [ ] Couleur/codes visuels par company
- [ ] Recherche si > 5 companies
- [ ] Afficher le pays de la company (drapeau)
- [ ] Tooltips avec infos supplémentaires

**Nouveau composant:** `frontend/src/components/company-indicator.tsx`
```typescript
// Indicateur visuel de la company active (header ou barre fixe)
// Affiche: nom, rôle, pays
```

#### 2.3.2 Gestion des Erreurs Multi-Tenant

**Fichier:** `frontend/src/hooks/use-fetch.ts`

**Améliorations:**
- [ ] Intercepteur pour erreur 403 (accès company refusé)
- [ ] Redirection automatique vers company valide
- [ ] Toast notification "Accès révoqué"
- [ ] Retry avec backoff exponentiel

**Nouveau hook:** `frontend/src/hooks/use-company-validation.ts`
```typescript
// Valide que l'utilisateur a toujours accès à la company active
// Sur changement de companies list, vérifie l'accès
```

#### 2.3.3 Loading States Améliorés

**Composants à améliorer:**
- [ ] `frontend/src/components/company-switcher.tsx` - Skeleton plus informatif
- [ ] `frontend/src/pages/(app)/_layout.tsx` - Page de transition pendant switch
- [ ] `frontend/src/contexts/company.tsx` - État de chargement plus granulaire

**Nouveau composant:** `frontend/src/components/company-loading.tsx`
```typescript
// Écran de chargement avec animation de transition
// Logo + spinner + message "Changement de company..."
```

#### 2.3.4 Dashboard Multi-Company

**Fichier:** `frontend/src/pages/dashboard.tsx`

**Améliorations:**
- [ ] Afficher le pays de la company (drapeau + nom)
- [ ] Indicateur de compliance par pays
- [ ] Alertes si configuration incomplète

---

### Phase 4: Tests Multi-Tenant (Jours 8-10)
**Agent Backend + Frontend** - Skill: `e2e-testing-patterns`

#### 2.4.1 Tests Backend (Jest)

**Fichier:** `backend/src/modules/compliance/__tests__/country-configs.test.ts`
```typescript
describe('Country Configs', () => {
  it('should load FR config with correct VAT rates', () => {});
  it('should load DE config with Peppol enabled', () => {});
  it('should fallback to generic for unsupported country', () => {});
});
```

**Fichier:** `backend/src/guards/__tests__/company.guard.test.ts`
```typescript
describe('CompanyGuard', () => {
  it('should allow access to user company', () => {});
  it('should deny access to other company', () => {});
  it('should allow SYSTEM_ADMIN access to all', () => {});
  it('should extract companyId from header', () => {});
});
```

**Fichier:** `backend/src/modules/compliance/transmission/__tests__/strategies.test.ts`
```typescript
describe('Transmission Strategies', () => {
  it('should register all strategies', () => {});
  it('should select correct strategy for platform', () => {});
  it('should fallback to email if strategy fails', () => {});
});
```

#### 2.4.2 Tests E2E (Cypress)

**Fichier:** `e2e/cypress/e2e/multi-tenant/company-switch.cy.ts`
```typescript
describe('Company Switch', () => {
  it('should switch between companies', () => {});
  it('should persist company selection', () => {});
  it('should show company data isolation', () => {});
  it('should handle 403 errors gracefully', () => {});
});
```

**Fichier:** `e2e/cypress/e2e/multi-tenant/data-isolation.cy.ts`
```typescript
describe('Data Isolation', () => {
  it('should show only company A invoices for user A', () => {});
  it('should not show company B data to company A user', () => {});
  it('should maintain isolation after page refresh', () => {});
});
```

#### 2.4.3 Tests de Performance

**Fichier:** `backend/src/modules/compliance/__tests__/performance.test.ts`
```typescript
describe('Multi-tenant Performance', () => {
  it('should handle 100 concurrent numbering requests', () => {});
  it('should not have cross-tenant leakage under load', () => {});
  it('should maintain < 100ms response time for config lookup', () => {});
});
```

---

## 3. Ordre de Priorité

### Sprint 1 (Jours 1-3): Fondations Backend
1. ⭐ Créer fr.config.ts (France)
2. ⭐ Créer de.config.ts (Allemagne)
3. ⭐ Enregistrer configs dans l'index
4. 🔄 Parallèle: Améliorations CompanySwitcher

### Sprint 2 (Jours 4-6): Stratégies Core
1. ⭐ Implémenter ChorusStrategy
2. ⭐ Implémenter PeppolStrategy (mock)
3. ⭐ Enregistrer stratégies
4. 🔄 Parallèle: Gestion erreurs multi-tenant

### Sprint 3 (Jours 7-8): Pays Additionnels
1. Créer it.config.ts (Italie)
2. Implémenter SdIStrategy
3. Créer es.config.ts (Espagne)
4. Implémenter VerifactuStrategy

### Sprint 4 (Jours 9-10): Portugal + Tests
1. Créer pt.config.ts (Portugal)
2. Tests unitaires backend
3. Tests E2E
4. Tests performance

---

## 4. Points de Synchronisation

### Checkpoints Obligatoires

| Checkpoint | Agent | Validation |
|------------|-------|------------|
| CP1 - FR Config | Backend | `getCountryConfig('FR')` retourne config valide |
| CP2 - DE Config | Backend | `getCountryConfig('DE')` retourne config valide |
| CP3 - Chorus | Backend | `TransmissionService.send('chorus', ...)` fonctionne |
| CP4 - Peppol | Backend | `TransmissionService.send('peppol', ...)` fonctionne |
| CP5 - CompanySwitcher | Frontend | UI affiche rôle + recherche fonctionne |
| CP6 - Error Handling | Frontend | 403 redirige + toast affiché |
| CP7 - IT Config | Backend | Config IT avec clearance SDI |
| CP8 - ES Config | Backend | Config ES avec hash chain |
| CP9 - Tests E2E | E2E | Tous les tests passent |

### Communication
- **Daily Sync:** Rapport court à l'orchestrateur
- **Blocage:** Signaler immédiatement si bloqué > 30min
- **Validation:** Demander review avant de merger

---

## 5. Critères de Succès

### 5.1 Backend

- [ ] **Configs:** 5 pays configurés (FR, DE, IT, ES, PT)
- [ ] **Transmission:** 4 stratégies implémentées (Chorus, Peppol, SDI, Verifactu)
- [ ] **Isolation:** 100% des requêtes filtrent par companyId
- [ ] **Tests:** > 80% coverage sur module compliance

### 5.2 Frontend

- [ ] **UX:** CompanySwitcher affiche rôle + pays
- [ ] **Erreurs:** Gestion 403 avec redirection auto
- [ ] **Loading:** Transitions fluides entre companies
- [ ] **Tests:** E2E couvrent switch + isolation

### 5.3 Intégration

- [ ] **End-to-End:** Création facture → Transmission → Vérification statut
- [ ] **Multi-tenant:** Aucune fuite de données entre companies
- [ ] **Performance:** < 200ms pour config lookup

### 5.4 Documentation

- [ ] Mise à jour `docs/compliance/` si changements
- [ ] Guide d'utilisation multi-company
- [ ] Guide développeur pour ajouter pays

---

## 6. Ressources

### Documentation Pays
- `/docs/compliance/FR-France.md`
- `/docs/compliance/DE-Germany.md`
- `/docs/compliance/IT-Italy.md`
- `/docs/compliance/ES-Spain.md`
- `/docs/compliance/PT-Portugal.md`

### Architecture
- `/docs/compliance/ARCHITECTURE.md` - Architecture complète module compliance
- `/backend/EXPLORATION_REPORT.md` - Analyse backend détaillée
- `/frontend/EXPLORATION_REPORT.md` - Analyse frontend détaillée

### Code de Référence
- `backend/src/modules/compliance/configs/generic.config.ts` - Template config
- `backend/src/modules/compliance/transmission/strategies/email.strategy.ts` - Template stratégie
- `frontend/src/components/company-switcher.tsx` - Composant à améliorer

---

## 7. Notes pour les Agents

### Backend Agent
1. **Activer skill:** `skill nestjs-best-practices` avant de commencer
2. **Pattern:** Suivre l'architecture existante dans `generic.config.ts`
3. **Tests:** Créer tests pour chaque config/stratégie
4. **Commits:** Format gitmoji - ex: `🇫🇷 feat(backend): add France country config`

### Frontend Agent
1. **Activer skill:** `skill vercel-react-best-practices` avant de commencer
2. **Pattern:** Suivre les conventions shadcn/ui existantes
3. **i18n:** Ajouter clés de traduction dans `/locales/fr/common.json`
4. **Commits:** Format gitmoji - ex: `✨ feat(frontend): improve CompanySwitcher UX`

### Général
- Ne PAS modifier la structure de la base de données (déjà optimale)
- Ne PAS toucher aux guards d'authentification (déjà fonctionnels)
- PAS de fournisseur de paiement (hors scope)
- PAS de TODO.md dans les commits

---

## 8. Risques et Mitigations

| Risque | Probabilité | Impact | Mitigation |
|--------|-------------|--------|------------|
| API Chorus indisponible pour tests | Moyenne | Haute | Implémenter mock d'abord |
| Complexité Peppol | Haute | Moyenne | Focus sur mock, pas full implémentation |
| Régression multi-tenant | Moyenne | Critique | Tests E2E complets avant merge |
| Performance config lookup | Basse | Moyenne | Cache des configs en mémoire |

---

## 9. Post-Phase: Améliorations Futures

Une fois les 4 phases complétées:

1. **Caching:** Cache Redis des configs pays
2. **Monitoring:** Métriques par tenant
3. **Audit Logging:** Logs avec companyId
4. **RLS PostgreSQL:** Row-Level Security optionnelle
5. **Nouveaux pays:** BE, NL, AT, PL...

---

**Plan validé par:** Agent Orchestrateur Principal  
**Date de validation:** 2026-02-04  
**Prochaine étape:** Distribution aux agents spécialisés

---

## Historique des Révisions

| Version | Date | Auteur | Changements |
|---------|------|--------|-------------|
| 1.0 | 2026-02-04 | Orchestrateur | Création initiale |
