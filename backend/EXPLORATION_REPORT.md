# Rapport d'Exploration Backend - Système Multi-Tenant

**Date**: 2026-02-04  
**Projet**: Invoicerr - Application de facturation pour freelances  
**Objectif**: Analyser la structure actuelle pour préparer l'implémentation du système multi-tenant de facturation dynamique

---

## 1. Vue d'Ensemble de l'Architecture

### 1.1 Stack Technique
- **Framework**: NestJS 10+ avec TypeScript
- **ORM**: Prisma avec PostgreSQL
- **Authentification**: Better Auth (JWT + OIDC)
- **Tests**: Jest (unit) + Cypress (E2E)
- **Documentation**: Architecture compliance détaillée dans `/docs/compliance/ARCHITECTURE.md`

### 1.2 Structure du Projet
```
backend/
├── src/
│   ├── modules/           # Modules fonctionnels NestJS
│   │   ├── compliance/    # Module complexe de conformité multi-pays
│   │   ├── invoices/      # Gestion des factures
│   │   ├── quotes/        # Gestion des devis
│   │   ├── receipts/      # Gestion des reçus
│   │   ├── clients/       # Gestion des clients
│   │   ├── company/       # Gestion des entreprises
│   │   ├── webhooks/      # Système de webhooks
│   │   └── ...
│   ├── decorators/        # Décorateurs personnalisés
│   ├── guards/            # Guards d'authentification/autorisation
│   ├── types/             # Types TypeScript
│   └── prisma/            # Service Prisma
└── prisma/
    └── schema.prisma      # Schéma de données
```

---

## 2. Analyse du Schéma de Données

### 2.1 Architecture Multi-Tenant Déjà Implémentée

Le système utilise déjà une architecture **Shared Database with TenantID** bien structurée:

#### Entités Principales et Relations

```
User (Better Auth)
  └── UserCompany[] (relation many-to-many avec rôles)
        ├── companyId -> Company
        └── role: SYSTEM_ADMIN | OWNER | ADMIN | ACCOUNTANT

Company (Tenant principal)
  ├── users[] -> UserCompany[]
  ├── clients[] -> Client[]
  ├── quotes[] -> Quote[]
  ├── invoices[] -> Invoice[]
  ├── receipts[] -> Receipt[]
  ├── paymentMethods[] -> PaymentMethod[]
  ├── webhooks[] -> Webhook[]
  ├── complianceSettings -> ComplianceSettings (1:1)
  └── pdfConfig -> PDFConfig (1:1)

Client (appartient à un Company)
  ├── companyId (FK, indexé, cascade delete)
  ├── quotes[] -> Quote[]
  └── invoices[] -> Invoice[]

Quote/Invoice/Receipt (appartiennent à un Company)
  ├── companyId (FK, indexé)
  ├── clientId (FK)
  └── items[] (embedded)
```

### 2.2 Points Clés du Schéma

| Entité | Clé Tenant | Cascade | Notes |
|--------|------------|---------|-------|
| `Company` | - | - | Entité racine du tenant |
| `Client` | `companyId` | `onDelete: Cascade` | Soft delete via `isActive` |
| `Quote` | `companyId` | - | Soft delete via `isActive` |
| `Invoice` | `companyId` | - | Soft delete via `isActive` |
| `Receipt` | `invoiceId` | - | Lié à une facture |
| `PaymentMethod` | `companyId` | `onDelete: Cascade` | - |
| `Webhook` | `companyId` | - | Indexé |
| `ComplianceSettings` | `companyId` | `onDelete: Cascade` | 1:1 avec Company |
| `NumberingSequence` | `companyId` | - | Pour la numérotation séquentielle |
| `MailTemplate` | `companyId` | `onDelete: Cascade` | Templates email par company |

### 2.3 Modèle UserCompany (Multi-tenant)

```prisma
model UserCompany {
  id        String          @id @default(cuid())
  userId    String
  companyId String
  role      UserCompanyRole // SYSTEM_ADMIN, OWNER, ADMIN, ACCOUNTANT
  joinedAt  DateTime        @default(now())
  isDefault Boolean         @default(false) // Company par défaut

  @@unique([userId, companyId])
  @@index([userId])
  @@index([companyId])
}
```

---

## 3. Système de Guards Multi-Tenant

### 3.1 CompanyGuard (Garde d'Isolation)

**Fichier**: `src/guards/company.guard.ts`

Ce guard est appliqué globalement via `APP_GUARD` et assure:

1. **Extraction du CompanyId** (priorité):
   - Header `X-Company-Id` (recommandé pour API clients)
   - Route parameter `:companyId`
   - Query parameter `?companyId=`

2. **Validation d'accès**:
   - Vérifie que l'utilisateur appartient au company (via `UserCompany`)
   - Les SYSTEM_ADMIN peuvent accéder à tous les companies
   - Fallback sur le company par défaut (`isDefault: true`)

3. **Attachement du contexte**:
   ```typescript
   interface CompanyContext {
     companyId: string;
     company: Company;
     userCompany: UserCompany;
     role: UserCompanyRole;
   }
   ```

### 3.2 Décorateurs Multi-Tenant

**Fichier**: `src/decorators/company.decorator.ts`

```typescript
@CompanyId() companyId: string           // Extrait companyId
@CurrentCompany() context: CompanyContext // Contexte complet
```

### 3.3 Exemple d'Utilisation dans les Contrôleurs

```typescript
@Controller('invoices')
export class InvoicesController {
  @Get()
  getInvoices(
    @CompanyId() companyId: string,
    @Query('page') page: string,
  ) {
    return this.service.getInvoices(companyId, page);
  }
}
```

---

## 4. Analyse Approfondie du Module Compliance

### 4.1 Architecture du Module (Très Sophistiquée)

**Fichier**: `/docs/compliance/ARCHITECTURE.md`

Le module compliance est conçu pour supporter la conformité fiscale multi-pays avec:

#### Modèles de Facturation Électronique Supportés

| Modèle | Pays | Principe |
|--------|------|----------|
| **Clearance** | IT, PL, IN, MY | Validation préalable par autorité fiscale |
| **PDP/Y-model** | FR | Plateformes privées certifiées |
| **Real-time reporting** | HU, GR | Déclaration en temps réel sans validation |
| **Hash chaining** | ES, PT | Signature cryptographique en chaîne |
| **Peppol** | DE, BE, NL, NO, SE, AT, AU, NZ, JP, SG | Réseau européen/international |
| **Email** | Tous | Fallback universel |

#### Structure du Module

```
backend/src/modules/compliance/
├── compliance.module.ts           # Module NestJS
├── compliance.service.ts          # Façade principale
├── compliance.controller.ts       # Endpoints REST
│
├── configs/                       # Configurations par pays
│   ├── index.ts                   # Registre de configs
│   ├── generic.config.ts          # Config fallback
│   └── countries/                 # Configs spécifiques (vide actuellement)
│
├── interfaces/                    # Types et contrats
│   ├── country-config.interface.ts
│   ├── document-config.interface.ts
│   ├── vat.interface.ts
│   ├── transmission.interface.ts
│   └── ...
│
├── services/                      # Logique métier
│   ├── context-builder.service.ts
│   ├── rule-resolver.service.ts
│   ├── vat-engine.service.ts
│   ├── numbering.service.ts
│   ├── hash-chain.service.ts
│   ├── qr-code.service.ts
│   ├── correction.service.ts
│   ├── compliance-settings.service.ts
│   └── ...
│
├── documents/                     # Génération documents
│   ├── document.service.ts        # Orchestrateur
│   ├── builders/                  # Builders par région
│   │   ├── base.builder.ts
│   │   ├── generic.builder.ts
│   │   └── eu.builder.ts
│   ├── templates/                 # Templates Handlebars
│   └── renderers/                 # Moteurs de rendu
│
├── formats/                       # Générateurs XML
│   ├── format.service.ts
│   └── generators/
│       ├── facturx.generator.ts
│       ├── ubl.generator.ts
│       └── fatturapa.generator.ts
│
└── transmission/                  # Envoi des factures
    ├── transmission.service.ts
    ├── resilient-transmission.service.ts
    └── strategies/
        ├── email.strategy.ts      # Fallback
        ├── chorus.strategy.ts     # FR B2G
        ├── peppol.strategy.ts     # Peppol
        ├── sdi.strategy.ts        # IT
        └── ...
```

### 4.2 Services Clés du Module Compliance

#### ComplianceService (Façade)

Point d'entrée unique pour toute la logique compliance:

```typescript
class ComplianceService {
  // Configuration
  getConfig(countryCode: string): CountryConfig
  isCountrySupported(code: string): boolean
  
  // Contexte et règles
  buildContext(input): Promise<TransactionContext>
  resolveRules(context): ApplicableRules
  
  // TVA
  calculateVAT(items, rules): VATCalculationResult
  
  // Numérotation
  generateInvoiceNumber(context, countryCode)
  checkNumberingGaps(companyId, series, existingNumbers)
  
  // Hash chain (ES, PT)
  generateInvoiceHash(input, countryCode): string
  
  // QR Code
  generateQRCode(input, countryCode): string
  
  // Corrections
  canModifyInvoice(invoice, countryCode): boolean
  createCreditNote(invoice, request, countryCode)
  
  // XML formats
  generateInvoiceXML(invoice, countryCode): Promise<FormatResult>
  
  // Transmission
  sendInvoice(platform, payload): Promise<TransmissionResult>
  checkTransmissionStatus(platform, externalId)
}
```

#### Services Spécifiques avec Prisma

| Service | Rôle | Dépendances Prisma |
|---------|------|-------------------|
| `NumberingService` | Génération numéros séquentiels | `numberingSequence` |
| `ComplianceSettingsService` | Gestion config compliance | `complianceSettings` |
| `HashChainService` | Chaîne de hash ES/PT | `numberingSequence.lastHash` |

### 4.3 Transmission Service avec Tenant Context

**Fichier**: `src/modules/compliance/transmission/transmission.service.ts`

Le payload de transmission inclut déjà le `companyId`:

```typescript
interface TransmissionPayload {
  companyId: string;        // Déjà intégré!
  invoiceId: string;
  invoiceNumber: string;
  pdfBuffer: Buffer;
  xmlContent?: string;
  recipient: { email, name, ... };
  sender: { email, name, ... };
  metadata: { ... };
}
```

### 4.4 Stratégies de Transmission Actuelles

| Stratégie | Plateforme | Statut | Pays |
|-----------|------------|--------|------|
| `EmailTransmissionStrategy` | `email` | Implémentée | Tous (fallback) |
| `ChorusStrategy` | `chorus` | À implémenter | FR B2G |
| `SuperPDPStrategy` | `superpdp` | À implémenter | FR B2B |
| `PeppolStrategy` | `peppol` | À implémenter | DE, BE, NL... |
| `SdIStrategy` | `sdi` | À implémenter | IT |
| `VerifactuStrategy` | `verifactu` | À implémenter | ES |
| `SaftStrategy` | `saft` | À implémenter | PT |

---

## 5. Points d'Intégration Multi-Tenant Identifiés

### 5.1 Déjà Multi-Tenant (Bien Implémenté)

Tous les modules métier suivants sont déjà correctement multi-tenant:

| Module | Isolation | Validation | Notes |
|--------|-----------|------------|-------|
| `invoices` | companyId | CompanyGuard | Toutes requêtes filtrent par companyId |
| `quotes` | companyId | CompanyGuard | Soft delete via isActive |
| `receipts` | companyId | CompanyGuard | Liés aux factures |
| `clients` | companyId | CompanyGuard | Vérification explicite dans les services |
| `payment-methods` | companyId | CompanyGuard | Cascade delete |
| `company` | companyId | CompanyGuard + rôles | Gestion des accès par rôle |
| `webhooks` | companyId | CompanyGuard | Indexé par companyId |

### 5.2 Services Multi-Tenant dans Compliance

| Service | Contexte Tenant | Méthode |
|---------|-----------------|---------|
| `NumberingService` | `companyId` en paramètre | Utilise `numberingSequence` avec clé composite `[companyId, series, documentType]` |
| `ComplianceSettingsService` | `companyId` en paramètre | Utilise `complianceSettings` (1:1 avec Company) |
| `DocumentService` | Via `supplierCountry` + données | Stateless, utilise les données passées |
| `TransmissionService` | Via `payload.companyId` | Déjà intégré dans le payload |

### 5.3 Schéma de Numérotation Multi-Tenant

**Fichier**: `src/modules/compliance/services/numbering.service.ts`

Utilise une table dédiée avec clé composite:

```typescript
// Prisma model
model NumberingSequence {
  id           String   @id @default(cuid())
  companyId    String   // Partie de la clé unique
  series       String?  // Partie de la clé unique
  documentType String   // Partie de la clé unique
  lastSequence Int      @default(0)
  lastHash     String?  // Pour hash chain ES/PT
  year         Int
  month        Int

  @@unique([companyId, series, documentType])
  @@index([companyId])
}
```

---

## 6. Stratégie Recommandée

### 6.1 Architecture Déjà en Place

Le système utilise déjà l'approche recommandée:

**Shared Database with TenantID** (Row-Level Security)

Cette approche est:
- Déjà implémentée et fonctionnelle
- Simple et efficace
- Compatible avec Prisma
- Permet le multi-tenant sans complexité schéma

### 6.2 Aucune Modification Majeure Requise

L'analyse révèle que:

1. **Toutes les entités ont déjà `companyId`**
2. **Le CompanyGuard est déjà appliqué globalement**
3. **Toutes les requêtes filtrent par companyId**
4. **Le soft delete est déjà en place** (`isActive`)

### 6.3 Points à Vérifier/Renforcer

| Module | Action | Priorité |
|--------|--------|----------|
| `compliance/configs` | Ajouter configs pays spécifiques (FR, DE, IT...) | Haute |
| `compliance/transmission` | Implémenter stratégies spécifiques pays | Haute |
| `NumberingService` | Vérifier atomicité transactions multi-tenant | Moyenne |
| `WebhookDispatcher` | Déjà multi-tenant, vérifier contexte companyId | Basse |
| `Logger` | Ajouter companyId aux logs pour traçabilité | Basse |

---

## 7. Dépendances entre Modules

### 7.1 Graphe de Dépendances

```
AppModule
├── AuthModule (Better Auth)
├── CompanyModule
│   └── WebhooksModule
├── ClientsModule
├── QuotesModule
│   ├── ComplianceModule (DocumentService)
│   └── WebhooksModule
├── InvoicesModule
│   ├── ComplianceModule (ComplianceService, DocumentService)
│   └── WebhooksModule
├── ReceiptsModule
├── ComplianceModule (racine)
│   ├── DocumentService
│   ├── FormatService
│   ├── TransmissionService
│   └── Services métier (VAT, Numbering, etc.)
├── WebhooksModule
├── PaymentMethodsModule
├── SignaturesModule
└── PluginsModule
```

### 7.2 Dépendances Critiques pour Multi-Tenant

| Module | Dépend de | Impact Multi-Tenant |
|--------|-----------|---------------------|
| `InvoicesService` | `ComplianceService`, `DocumentService` | Les services compliance sont stateless ou reçoivent companyId |
| `QuotesService` | `DocumentService` | Stateless |
| `WebhookDispatcher` | `WebhooksService` | Filtre déjà par companyId |
| `NumberingService` | `PrismaService` | Utilise companyId dans requêtes |

---

## 8. Recommandations pour l'Implémentation

### 8.1 Court Terme (Déjà Prêt)

Le système multi-tenant de base est déjà fonctionnel. Les éléments suivants sont prêts:

- [x] Schéma de données avec companyId
- [x] CompanyGuard global
- [x] Décorateurs @CompanyId et @CurrentCompany
- [x] Soft delete (isActive)
- [x] Relations User-Company avec rôles
- [x] Invitation system pour ajouter utilisateurs à un company

### 8.2 Moyen Terme (Améliorations Compliance)

1. **Ajouter les configurations pays**:
   ```
   backend/src/modules/compliance/configs/countries/
   ├── fr.config.ts    # France (Chorus, PDP)
   ├── de.config.ts    # Allemagne (ZUGFeRD, XRechnung)
   ├── it.config.ts    # Italie (FatturaPA, SDI)
   ├── es.config.ts    # Espagne (Verifactu)
   └── pt.config.ts    # Portugal (SAF-T)
   ```

2. **Implémenter les stratégies de transmission**:
   - `ChorusStrategy` pour la France B2G
   - `SuperPDPStrategy` pour la France B2B
   - `PeppolStrategy` pour le réseau Peppol
   - `SdIStrategy` pour l'Italie

3. **Renforcer la numérotation**:
   - Vérifier les transactions atomiques
   - Support des séries par pays
   - Gestion des resets annuels/mensuels

### 8.3 Long Terme (Optimisations)

1. **Caching par Tenant**:
   - Configs pays en cache
   - Résultats VAT calculés

2. **Audit Logging**:
   - Ajouter companyId à tous les logs
   - Traçabilité complète multi-tenant

3. **Sécurité Renforcée**:
   - Row-Level Security PostgreSQL (optionnel)
   - Validation supplémentaire dans les repositories

---

## 9. Conclusion

### 9.1 État Actuel

Le backend Invoicerr dispose déjà d'une **architecture multi-tenant mature et bien implémentée**:

- **Stratégie**: Shared Database with TenantID
- **Isolation**: Via CompanyGuard et filtres Prisma
- **Module Compliance**: Très sophistiqué et prêt pour l'international
- **Relations**: Toutes les entités liées à Company avec cascade appropriée

### 9.2 Aucune Refonte Majeure Nécessaire

Contrairement à ce qui pourrait être attendu, **aucune refonte majeure n'est requise** pour le système multi-tenant. L'architecture actuelle est déjà conforme aux meilleures pratiques.

### 9.3 Prochaines Étapes Prioritaires

1. Implémenter les configurations pays spécifiques dans `compliance/configs/countries/`
2. Développer les stratégies de transmission pour chaque pays cible
3. Tester la numérotation séquentielle sous charge multi-tenant
4. Documenter les workflows d'invitation et de gestion des rôles

---

## Annexes

### A. Fichiers Clés Multi-Tenant

| Fichier | Rôle |
|---------|------|
| `backend/src/guards/company.guard.ts` | Guard d'isolation multi-tenant |
| `backend/src/decorators/company.decorator.ts` | Décorateurs pour extraire contexte |
| `backend/src/types/company-context.ts` | Types du contexte multi-tenant |
| `backend/prisma/schema.prisma` | Schéma avec companyId et relations |
| `backend/src/modules/compliance/compliance.service.ts` | Façade compliance |
| `backend/src/modules/compliance/services/numbering.service.ts` | Numérotation multi-tenant |

### B. Configuration Prisma pour Multi-Tenant

```prisma
// Exemple: Toutes les entités ont companyId
model Invoice {
  id        String   @id @default(uuid())
  companyId String
  company   Company  @relation(fields: [companyId], references: [id])
  
  @@index([companyId])
}

model Client {
  id        String    @id @default(cuid())
  companyId String
  company   Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  
  @@index([companyId])
}
```

### C. Exemple de Requête Multi-Tenant Typique

```typescript
// Dans InvoicesService
async getInvoices(companyId: string, page: string) {
  // Toutes les requêtes filtrent par companyId
  const whereActive = { isActive: true, companyId };
  
  const [invoices, totalCount] = await Promise.all([
    prisma.invoice.findMany({
      where: whereActive,  // Isolation tenant
      include: {
        items: true,
        client: true,
      },
    }),
    prisma.invoice.count({ where: whereActive }),
  ]);
  
  return { invoices, totalCount };
}
```

---

*Rapport généré le 2026-02-04 par l'agent d'exploration backend*
