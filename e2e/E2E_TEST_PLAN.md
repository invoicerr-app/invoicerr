# 📋 Plan de Tests E2E - Invoicerr

## Vue d'ensemble du projet

Invoicerr est une application de gestion de facturation comprenant:
- **Backend**: NestJS avec Prisma ORM (PostgreSQL)
- **Frontend**: React avec TypeScript, shadcn/ui, react-hook-form + Zod
- **E2E Tests**: Cypress

---

## 🔗 Récapitulatif des Routes API

### 1. Auth Extended (`/auth-extended`)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/set-password` | Définir un nouveau mot de passe |

### 2. Clients (`/clients`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Liste des clients (paginée) |
| GET | `/sse` | Flux SSE temps réel |
| GET | `/search?query=` | Rechercher des clients |
| POST | `/` | Créer un client |
| PATCH | `/:id` | Modifier un client |
| DELETE | `/:id` | Supprimer un client |

### 3. Company (`/company`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/info` | Informations entreprise |
| GET | `/info/sse` | SSE infos entreprise |
| POST | `/info` | Modifier infos entreprise |
| GET | `/pdf-template` | Config template PDF |
| POST | `/pdf-template` | Modifier template PDF |
| GET | `/email-templates` | Templates email |
| PUT | `/email-templates` | Modifier template email |

### 4. Payment Methods (`/payment-methods`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Liste moyens de paiement |
| GET | `/sse` | SSE moyens de paiement |
| GET | `/:id` | Détail moyen de paiement |
| POST | `/` | Créer moyen de paiement |
| PATCH | `/:id` | Modifier moyen de paiement |
| DELETE | `/:id` | Supprimer (soft delete) |

### 5. Quotes (`/quotes`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Liste des devis (paginée) |
| GET | `/sse` | SSE devis |
| GET | `/search?query=` | Rechercher des devis |
| GET | `/:id/pdf` | Obtenir PDF devis |
| POST | `/` | Créer un devis |
| POST | `/mark-as-signed` | Marquer comme signé |
| PATCH | `/:id` | Modifier un devis |
| DELETE | `/:id` | Supprimer un devis |

### 6. Invoices (`/invoices`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Liste des factures (paginée) |
| GET | `/sse` | SSE factures |
| GET | `/search?query=` | Rechercher des factures |
| GET | `/:id/pdf` | Obtenir PDF facture |
| GET | `/:id/download/xml` | Télécharger XML |
| GET | `/:id/download/pdf` | Télécharger PDF |
| POST | `/` | Créer une facture |
| POST | `/create-from-quote` | Créer depuis devis |
| POST | `/mark-as-paid` | Marquer comme payée |
| POST | `/send` | Envoyer par email |
| PATCH | `/:id` | Modifier une facture |
| DELETE | `/:id` | Supprimer une facture |

### 7. Receipts (`/receipts`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Liste des reçus (paginée) |
| GET | `/sse` | SSE reçus |
| GET | `/search?query=` | Rechercher des reçus |
| GET | `/:id/pdf` | Obtenir PDF reçu |
| POST | `/` | Créer un reçu |
| POST | `/create-from-invoice` | Créer depuis facture |
| POST | `/send` | Envoyer par email |
| PATCH | `/:id` | Modifier un reçu |
| DELETE | `/:id` | Supprimer un reçu |

### 8. Recurring Invoices (`/recurring-invoices`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Liste factures récurrentes |
| GET | `/sse` | SSE factures récurrentes |
| GET | `/:id` | Détail facture récurrente |
| POST | `/` | Créer facture récurrente |
| PATCH | `/:id` | Modifier facture récurrente |
| DELETE | `/:id` | Supprimer facture récurrente |

### 9. Signatures (`/signatures`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/:id` | Récupérer signature (public) |
| POST | `/` | Créer signature pour devis |
| POST | `/:id/otp` | Générer code OTP (public) |
| POST | `/:id/sign` | Signer avec OTP (public) |

### 10. Invitations (`/invitations`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/can-register` | Vérifier si inscription possible (public) |
| GET | `/is-first-user` | Vérifier premier utilisateur (public) |
| POST | `/validate` | Valider code invitation (public) |
| POST | `/` | Créer une invitation |
| GET | `/` | Lister invitations |
| DELETE | `/:id` | Supprimer invitation |

### 11. Webhooks (`/webhooks`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/options` | Types et événements disponibles |
| GET | `/` | Liste webhooks |
| GET | `/:id` | Détail webhook |
| POST | `/` | Créer webhook |
| PATCH | `/:id` | Modifier webhook |
| DELETE | `/:id` | Supprimer webhook |

### 12. Stats (`/stats`)
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/monthly?year=` | Statistiques mensuelles |
| GET | `/yearly?start=&end=` | Statistiques annuelles |

### 13. Danger (`/danger`)
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/otp` | Demander code OTP |
| POST | `/reset/app?otp=` | Reset application |
| POST | `/reset/all?otp=` | Reset complet |

---

## 🖥️ Composants Frontend et Validations

### 1. Authentification

#### Sign-Up
| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `firstname` | text | requis | vide, espaces, caractères spéciaux, très long (>100 chars), émojis |
| `lastname` | text | requis | vide, espaces, caractères spéciaux, très long (>100 chars), émojis |
| `email` | email | requis, format email | vide, format invalide (`test`, `test@`, `@test.com`), email existant |
| `password` | password | requis | vide, trop court (<8 chars), sans lettre, sans chiffre, sans caractère spécial |
| `invitationCode` | text | requis si pas premier utilisateur | vide, code invalide, code expiré, code déjà utilisé |

#### Sign-In
| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `email` | email | format email | vide, format invalide, email inexistant |
| `password` | password | - | vide, mot de passe incorrect |

### 2. Company Settings

| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `name` | text | min(1), max(100) | vide, >100 chars, caractères spéciaux |
| `description` | text | max(500) | >500 chars |
| `legalId` | text | max(50) | >50 chars |
| `VAT` | text | max(15) | >15 chars, format invalide |
| `foundedAt` | date | pas dans le futur | date future |
| `currency` | select | requis | non sélectionné |
| `address` | text | min(1) | vide |
| `postalCode` | text | regex `/^[0-9A-Z\s-]{3,10}$/` | <3 chars, >10 chars, caractères invalides |
| `city` | text | min(1) | vide |
| `country` | text | min(1) | vide |
| `phone` | tel | min(8), regex `/^[+]?[0-9\s\-()]{8,20}$/` | <8 chars, format invalide |
| `email` | email | requis, format email | vide, format invalide |
| `quoteStartingNumber` | number | min(1) | 0, négatif, décimal, texte |
| `quoteNumberFormat` | text | min(1), max(100), format spécial | vide, sans `{number}` |
| `invoiceStartingNumber` | number | min(1) | 0, négatif |
| `invoiceNumberFormat` | text | min(1), max(100), format spécial | format invalide |
| `receiptStartingNumber` | number | min(1) | 0, négatif |
| `receiptNumberFormat` | text | min(1), max(100), format spécial | format invalide |
| `invoicePDFFormat` | select | valeurs: pdf, facturx, zugferd, xrechnung, ubl, cii | valeur invalide |
| `dateFormat` | select | formats prédéfinis | valeur invalide |

### 3. Clients

| Champ | Type | Validations (COMPANY) | Validations (INDIVIDUAL) | Cas de test |
|-------|------|----------------------|--------------------------|-------------|
| `type` | select | COMPANY/INDIVIDUAL | - | - |
| `name` | text | requis si COMPANY | optionnel | vide pour COMPANY |
| `contactFirstname` | text | optionnel | requis si INDIVIDUAL | vide pour INDIVIDUAL |
| `contactLastname` | text | optionnel | requis si INDIVIDUAL | vide pour INDIVIDUAL |
| `description` | text | max(500) | max(500) | >500 chars |
| `legalId` | text | requis si COMPANY, max(50) | max(50) | vide pour COMPANY, >50 chars |
| `VAT` | text | regex EU VAT `/^[A-Z]{2}[0-9A-Z]{8,12}$/`, max(15) | même | format invalide (`123`, `FR123`, `FR12345678901234`) |
| `currency` | select | optionnel | optionnel | - |
| `foundedAt` | date | pas dans le futur | pas dans le futur | date future |
| `contactEmail` | email | requis, format email | requis, format email | vide, format invalide, email dupliqué |
| `contactPhone` | tel | regex `/^[+]?[0-9\s\-()]{8,20}$/` | même | format invalide |
| `address` | text | requis | requis | vide |
| `postalCode` | text | regex `/^[0-9A-Z\s-]{3,10}$/` | même | format invalide |
| `city` | text | requis | requis | vide |
| `country` | text | requis | requis | vide |

### 4. Payment Methods

| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `name` | text | min(1) | vide, espaces uniquement |
| `details` | text | optionnel | très long texte |
| `type` | select | BANK_TRANSFER, PAYPAL, CASH, CHECK, OTHER | - |

### 5. Quotes

| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `title` | text | optionnel | très long |
| `clientId` | select | requis | non sélectionné |
| `currency` | select | optionnel | - |
| `validUntil` | date | optionnel | date passée |
| `notes` | textarea | optionnel | très long |
| `paymentMethodId` | select | optionnel | - |
| `items` | array | au moins 1 item | 0 items |

#### Items de devis
| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `description` | text | requis | vide |
| `type` | select | HOUR, DAY, DEPOSIT, SERVICE, PRODUCT | - |
| `quantity` | number | min(1) | 0, négatif, décimal, texte, très grand (>999999) |
| `unitPrice` | number | min(0) | négatif, décimal avec beaucoup de chiffres, texte, très grand |
| `vatRate` | number | min(0) | négatif, >100, décimal, texte |

### 6. Invoices

| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `quoteId` | select | optionnel | - |
| `clientId` | select | requis | non sélectionné |
| `currency` | select | optionnel | - |
| `dueDate` | date | optionnel | date passée, date très lointaine |
| `notes` | textarea | optionnel | - |
| `paymentMethodId` | select | optionnel | - |
| `items` | array | au moins 1 item | 0 items |

### 7. Receipts

| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `invoiceId` | select | optionnel mais logiquement requis | non sélectionné |
| `paymentMethodId` | select | optionnel | - |
| `items` | array | sélection d'items de facture | aucun item sélectionné |

#### Items de reçu
| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `amountPaid` | number | min(0) | négatif, > montant dû, décimal |

### 8. Account Settings

#### Profil
| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `firstname` | text | requis | vide, espaces |
| `lastname` | text | requis | vide, espaces |
| `email` | email | requis, format email | format invalide |

#### Mot de passe
| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `currentPassword` | password | requis si compte credential | vide, incorrect |
| `password` | password | min(8), lettre, chiffre, caractère spécial | <8, sans lettre, sans chiffre, sans spécial |
| `confirmPassword` | password | doit correspondre | différent de password |

### 9. Webhooks

| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `url` | text | URL valide | vide, format invalide |
| `type` | select | GENERIC, DISCORD, MATTERMOST, SLACK, TEAMS, ZAPIER, ROCKETCHAT | - |
| `events` | multiselect | liste d'événements | aucun événement |
| `secret` | text | optionnel | - |

### 10. Invitations

| Champ | Type | Validations | Cas de test |
|-------|------|-------------|-------------|
| `expiresInDays` | number | min(1), optionnel | 0, négatif |

---

## 🧪 Cas de Test Edge Cases & Scénarios Difficiles

### Données limites (Boundary Testing)

#### Nombres
- `0` (zéro)
- `-1` (négatif)
- `0.0001` (très petit décimal)
- `999999999` (très grand)
- `NaN` (not a number)
- `Infinity`
- Texte à la place de nombre

#### Textes
- Chaîne vide `""`
- Espaces uniquement `"   "`
- Caractères spéciaux `!@#$%^&*()_+-=[]{}|;':",./<>?`
- Émojis `🎉😀🔥`
- Unicode `àéïõü ñ ß æ ø å`
- HTML injection `<script>alert('xss')</script>`
- SQL injection `'; DROP TABLE users; --`
- Très longue chaîne (10000+ caractères)
- Retours à la ligne `\n\r`
- Tabulations `\t`

#### Emails
- `test` (sans @)
- `test@` (sans domaine)
- `@test.com` (sans local part)
- `test@test` (sans TLD)
- `test@@test.com` (double @)
- `test@test..com` (double point)
- `très.long.email.avec.beaucoup.de.points@domaine.très.long.avec.sous.domaines.com`

#### Téléphones
- `123` (trop court)
- `+33 1 23 45 67 89` (format valide)
- `(555) 123-4567` (format US)
- `abc123` (avec lettres)
- `++++123456` (multiples +)

#### Codes postaux
- `1` (trop court)
- `12345678901` (trop long)
- `abc` (lettres non supportées selon regex)
- `12-345` (avec tiret)
- `12 345` (avec espace)

#### TVA
- `FR` (trop court)
- `FR12345678901234567890` (trop long)
- `fr12345678901` (minuscules)
- `1234567890123` (sans pays)
- `ABCD12345678901` (pays invalide)

#### Dates
- Date dans le futur (pour foundedAt)
- Date très ancienne (01/01/1900)
- Date invalide (31/02/2024)
- Format incorrect

### Scénarios de flux métier

#### Création de devis puis facture
1. Créer un client
2. Créer un devis pour ce client
3. Signer le devis
4. Créer une facture à partir du devis
5. Vérifier que les items sont copiés

#### Paiement partiel
1. Créer une facture avec plusieurs items
2. Créer un reçu partiel (payer une partie)
3. Vérifier le statut de la facture
4. Créer un autre reçu pour le reste
5. Vérifier que la facture est marquée payée

#### Gestion des codes d'invitation
1. Créer un code d'invitation
2. Copier le code
3. Déconnexion
4. Inscription avec le code
5. Vérifier que le code est marqué utilisé
6. Tenter de réutiliser le code (doit échouer)

#### Signature de devis (flow externe)
1. Créer un devis
2. Envoyer pour signature
3. Récupérer le lien de signature
4. Accéder au lien (non authentifié)
5. Demander OTP
6. Signer avec OTP
7. Vérifier le statut du devis

---

## 📊 Ordre d'exécution des tests

Les tests doivent s'exécuter dans cet ordre car ils ont des dépendances:

1. **1-auth.cy.ts** - Authentification (créer le premier utilisateur, invitations)
2. **2-company.cy.ts** - Paramètres entreprise (requis pour les documents)
3. **3-payment-methods.cy.ts** - Moyens de paiement (utilisés dans devis/factures)
4. **4-clients.cy.ts** - Clients (requis pour devis/factures)
5. **5-quotes.cy.ts** - Devis
6. **6-invoices.cy.ts** - Factures
7. **7-receipts.cy.ts** - Reçus
8. **8-recurring-invoices.cy.ts** - Factures récurrentes
9. **9-signatures.cy.ts** - Signatures de devis
10. **10-stats.cy.ts** - Statistiques
11. **11-webhooks.cy.ts** - Webhooks
12. **12-account-settings.cy.ts** - Paramètres compte
13. **13-danger-zone.cy.ts** - Zone de danger (reset)

---

## 🏷️ Convention de nommage data-cy

Tous les sélecteurs doivent utiliser `data-cy` avec le format suivant:
- `[module]-[element]-[action]` ou `[module]-[element]`

Exemples:
- `data-cy="auth-email-input"`
- `data-cy="auth-submit-btn"`
- `data-cy="client-dialog"`
- `data-cy="client-name-input"`
- `data-cy="client-submit-btn"`
- `data-cy="quote-client-select"`
- `data-cy="quote-item-0-description"`
- `data-cy="invoice-download-pdf-btn"`

---

## ✅ Checklist par module

### Auth
- [ ] Inscription premier utilisateur (sans code invitation)
- [ ] Connexion
- [ ] Déconnexion
- [ ] Création code invitation
- [ ] Inscription avec code invitation valide
- [ ] Inscription avec code expiré
- [ ] Inscription avec code déjà utilisé
- [ ] Inscription sans code (quand requis)
- [ ] Connexion mauvais email
- [ ] Connexion mauvais mot de passe
- [ ] Validation email format
- [ ] Validation mot de passe format

### Company
- [ ] Remplir tous les champs valides
- [ ] Valider sauvegarde
- [ ] Champs vides (erreurs)
- [ ] Format téléphone invalide
- [ ] Format email invalide
- [ ] Format code postal invalide
- [ ] Format numérotation invalide
- [ ] Date fondation dans le futur
- [ ] Changement devise
- [ ] Changement format PDF

### Payment Methods
- [ ] Créer virement bancaire
- [ ] Créer PayPal
- [ ] Créer espèces
- [ ] Créer chèque
- [ ] Créer autre
- [ ] Modifier moyen de paiement
- [ ] Supprimer moyen de paiement
- [ ] Nom vide (erreur)

### Clients
- [ ] Créer client entreprise
- [ ] Créer client individuel
- [ ] Modifier client
- [ ] Supprimer client
- [ ] Rechercher client
- [ ] Email dupliqué (erreur)
- [ ] Format TVA invalide
- [ ] Format téléphone invalide
- [ ] Date fondation future (erreur)
- [ ] Basculer entre COMPANY et INDIVIDUAL

### Quotes
- [ ] Créer devis simple
- [ ] Créer devis multi-items
- [ ] Modifier devis
- [ ] Supprimer devis
- [ ] Ajouter item
- [ ] Supprimer item
- [ ] Réorganiser items (drag & drop)
- [ ] Marquer comme signé
- [ ] Télécharger PDF
- [ ] Sans client (erreur)
- [ ] Sans items (erreur)
- [ ] Quantité négative (erreur)
- [ ] Prix négatif (erreur)

### Invoices
- [ ] Créer facture simple
- [ ] Créer facture depuis devis
- [ ] Modifier facture
- [ ] Supprimer facture
- [ ] Marquer comme payée
- [ ] Envoyer par email
- [ ] Télécharger PDF
- [ ] Télécharger XML (Factur-X)
- [ ] Sans client (erreur)
- [ ] Sans items (erreur)

### Receipts
- [ ] Créer reçu depuis facture
- [ ] Créer reçu manuel
- [ ] Modifier reçu
- [ ] Supprimer reçu
- [ ] Paiement partiel
- [ ] Télécharger PDF
- [ ] Montant supérieur au dû (erreur)

### Recurring Invoices
- [ ] Créer facture récurrente hebdomadaire
- [ ] Créer facture récurrente mensuelle
- [ ] Modifier facture récurrente
- [ ] Supprimer facture récurrente
- [ ] Avec nombre d'occurrences
- [ ] Avec date de fin
- [ ] Auto-envoi activé

### Signatures
- [ ] Accéder à la page de signature (non authentifié)
- [ ] Demander OTP
- [ ] Signer avec OTP valide
- [ ] Signer avec OTP invalide (erreur)
- [ ] Signer avec OTP expiré (erreur)

### Account Settings
- [ ] Modifier prénom/nom
- [ ] Modifier email
- [ ] Changer mot de passe
- [ ] Mot de passe trop court (erreur)
- [ ] Mots de passe non concordants (erreur)
- [ ] Mot de passe sans caractère spécial (erreur)

### Webhooks
- [ ] Créer webhook générique
- [ ] Créer webhook Discord
- [ ] Modifier webhook
- [ ] Supprimer webhook
- [ ] URL invalide (erreur)
- [ ] Sans événements (erreur)

### Stats
- [ ] Voir statistiques mensuelles
- [ ] Voir statistiques annuelles
- [ ] Changer année
- [ ] Changer période

### Danger Zone
- [ ] Demander OTP
- [ ] Reset app avec OTP valide
- [ ] Reset avec OTP invalide (erreur)

---

## ✅ Fichiers de Tests Créés

| Fichier | Description | Nombre de Tests |
|---------|-------------|-----------------|
| `1-auth.cy.ts` | Authentification (signup, login, validation) | ~15 tests |
| `2-company.cy.ts` | Paramètres entreprise | ~12 tests |
| `3-payment-methods.cy.ts` | Moyens de paiement CRUD | ~8 tests |
| `4-clients.cy.ts` | Clients CRUD avec validation | ~15 tests |
| `5-quotes.cy.ts` | Devis CRUD avec validation | ~12 tests |
| `6-invoices.cy.ts` | Factures CRUD avec validation | ~12 tests |
| `7-receipts.cy.ts` | Reçus CRUD avec validation | ~15 tests |
| `8-settings.cy.ts` | Paramètres (compte, invitations, danger) | ~20 tests |
| `9-recurring-invoices.cy.ts` | Factures récurrentes CRUD | ~12 tests |
| `10-dashboard-navigation.cy.ts` | Dashboard et navigation | ~18 tests |

**Total estimé: ~139 tests E2E**

### Attributs data-cy Ajoutés

| Composant | Attributs |
|-----------|-----------|
| Sign-In | `signin-email`, `signin-password`, `signin-password-toggle`, `signin-submit`, `signin-signup-link` |
| Sign-Up | `signup-firstname`, `signup-lastname`, `signup-email`, `signup-password`, `signup-password-toggle`, `signup-invitation-code`, `signup-submit`, `signup-signin-link` |
| Company Settings | `company-name`, `company-description`, `company-legalid`, `company-vat`, `company-address`, `company-postalcode`, `company-city`, `company-country`, `company-phone`, `company-email`, `company-submit` |

