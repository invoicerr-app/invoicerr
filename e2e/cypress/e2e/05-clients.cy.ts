beforeEach(() => {
    cy.login();
});

describe('Clients E2E', () => {
    describe('Create Clients', () => {
        it('creates a company client', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('ACME Corporation');
            cy.get('[name="description"]').clear().type('A leading technology company');
            cy.selectCountry('client-country-select', 'United States');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('US12345678901');

            // The country-specific identifiers section (EIN, above) pushes this
            // select further down the scrollable dialog — scroll it into view first
            // or the opened options panel renders clipped by the dialog's overflow.
            cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
            cy.get('[data-cy="client-currency-select-options"]').should('be.visible');
            cy.get('[data-cy="client-currency-select"] input').type('Euro');
            cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();

            cy.get('[name="contactEmail"]').clear().type('contact@acme.org');
            cy.get('[name="contactPhone"]').clear().type('+1 23 456 7890');
            cy.get('[name="address"]').clear().type('123 Tech Boulevard');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('San Francisco');

            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('ACME Corporation', { timeout: 10000 });
        });

        it('creates an individual client', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="client-type-select"]').click();
            cy.get('[data-cy="client-type-individual"]').click();

            cy.get('[name="contactFirstname"]').clear().type('Jane');
            cy.get('[name="contactLastname"]').clear().type('Doe');
            cy.get('[name="description"]').clear().type('Freelance developer');

            cy.get('[data-cy="client-currency-select"] button').click();
            cy.get('[data-cy="client-currency-select-options"]').should('be.visible');
            cy.get('[data-cy="client-currency-select"] input').type('Dollar');
            cy.get('[data-cy="client-currency-select-option-united-states-dollar-($)"]').click();

            cy.get('[name="contactEmail"]').clear().type('jane.doe@freelance.org');
            cy.get('[name="contactPhone"]').clear().type('+1 98 765 4321');
            cy.get('[name="address"]').clear().type('456 Developer Lane');
            cy.get('[name="postalCode"]').clear().type('67890');
            cy.get('[name="city"]').clear().type('Los Angeles');
            cy.selectCountry('client-country-select', 'United States');

            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('Jane', { timeout: 10000 });
            cy.contains('Doe');
        });
    });

    describe('Validation Errors - Company', () => {
        it('shows error for empty company name', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear();
            cy.selectCountry('client-country-select', 'France');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('12345');
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');

            cy.get('[data-cy="client-submit"]').click();
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/required|requis|nom/i);
        });

        it('shows error for empty legalId (company)', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('Test Company');
            cy.selectCountry('client-country-select', 'France');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear();
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');

            cy.get('[data-cy="client-submit"]').click();
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/required|requis|siret|legal/i);
        });
    });

    describe('Validation Errors - Individual', () => {
        it('shows error for empty firstname (individual)', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="client-type-select"]').click();
            cy.get('[data-cy="client-type-individual"]').click();

            cy.get('[name="contactFirstname"]').clear();
            cy.get('[name="contactLastname"]').clear().type('Smith');
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');
            cy.selectCountry('client-country-select', 'France');

            cy.get('[data-cy="client-submit"]').click();
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/required|requis|firstname|prénom/i);
        });

        it('shows error for empty lastname (individual)', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="client-type-select"]').click();
            cy.get('[data-cy="client-type-individual"]').click();

            cy.get('[name="contactFirstname"]').clear().type('John');
            cy.get('[name="contactLastname"]').clear();
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');
            cy.selectCountry('client-country-select', 'France');

            cy.get('[data-cy="client-submit"]').click();
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/required|requis|lastname|nom/i);
        });
    });

    describe('Common Validation Errors', () => {
        it('shows error for empty email', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('Test Company');
            cy.selectCountry('client-country-select', 'France');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('12345');
            cy.get('[name="contactEmail"]').clear();
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');

            cy.get('[data-cy="client-submit"]').click();
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/required|requis|email/i);
        });

        it('shows error for invalid email format', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="contactEmail"]').clear().type('not-an-email');
            cy.get('[data-cy="client-submit"]').click();
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/format|invalid|invalide|email/i);
        });

        it('shows error for invalid postal code format', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="name"]').clear().type('Test Company');
            cy.selectCountry('client-country-select', 'France');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('12345');
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('AB');
            cy.get('[name="city"]').clear().type('Test City');

            cy.get('[data-cy="client-submit"]').click();
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/format|invalid|invalide|postal|code/i);
        });

        it('shows error for invalid VAT format', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="name"]').clear().type('Test Company');
            cy.selectCountry('client-country-select', 'France');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('12345');
            cy.get('[data-cy="client-identifier-VAT"]').clear().type('123456');
            cy.get('[name="contactEmail"]').clear().type('test@test.com');
            cy.get('[name="address"]').clear().type('123 Test St');
            cy.get('[name="postalCode"]').clear().type('12345');
            cy.get('[name="city"]').clear().type('Test City');

            cy.get('[data-cy="client-submit"]').click();
            cy.get('[data-cy="client-dialog"]').should('be.visible');
            cy.contains(/format|invalid|invalide|vat|tva/i);
        });
    });

    describe('Extended Address Fields', () => {
        it('creates a client with addressLine2 and state (US address)', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('Tech Innovations LLC');
            cy.selectCountry('client-country-select', 'United States');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('US11223344556');
            cy.get('[name="contactEmail"]').clear().type('info@techinnovations.com');
            cy.get('[name="address"]').clear().type('456 Innovation Drive');
            cy.get('[name="addressLine2"]').clear().type('Suite 200');
            cy.get('[name="postalCode"]').clear().type('94105');
            cy.get('[name="city"]').clear().type('San Francisco');
            cy.get('[name="state"]').clear().type('CA');

            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('Tech Innovations', { timeout: 10000 });
        });

        it('verifies addressLine2 and state are displayed in client view', () => {
            cy.visit('/clients');
            cy.wait(2000);
            cy.get('[data-cy="view-client-button-info@techinnovations.com"]').click();
            cy.contains('456 Innovation Drive');
            cy.contains('Suite 200');
            cy.contains('CA');
        });

        it('creates a client with addressLine2 only (European address)', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('European Solutions GmbH');
            cy.selectCountry('client-country-select', 'Germany');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('DE987654321');
            cy.get('[name="contactEmail"]').clear().type('contact@eusolutions.de');
            cy.get('[name="address"]').clear().type('Hauptstrasse 42');
            cy.get('[name="addressLine2"]').clear().type('3. Etage');
            cy.get('[name="postalCode"]').clear().type('10115');
            cy.get('[name="city"]').clear().type('Berlin');

            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('European Solutions', { timeout: 10000 });
        });

        it('creates a client without addressLine2 and state (backward compatibility)', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('Simple Company Ltd');
            cy.selectCountry('client-country-select', 'United Kingdom');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('UK123456789');
            cy.get('[name="contactEmail"]').clear().type('info@simple.co.uk');
            cy.get('[name="address"]').clear().type('10 Downing Street');
            cy.get('[name="postalCode"]').clear().type('SW1A 2AA');
            cy.get('[name="city"]').clear().type('London');

            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('Simple Company', { timeout: 10000 });
        });

        it('edits a client and adds addressLine2 and state', () => {
            cy.visit('/clients');
            cy.wait(2000);

            cy.get('[data-cy="edit-client-button-info@simple.co.uk"]').click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="addressLine2"]').clear().type('Building B');
            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.wait(2000);

            cy.get('[data-cy="view-client-button-info@simple.co.uk"]').click();
            cy.contains('Building B');
        });
    });

    describe('Edge Cases', () => {
        it('handles special characters in name', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type("O'Reilly & Associates, Inc.");
            cy.selectCountry('client-country-select', 'United States');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('US98765432101');
            cy.get('[name="contactEmail"]').clear().type('info@oreilly.com');
            cy.get('[name="address"]').clear().type('789 Publishing Way');
            cy.get('[name="postalCode"]').clear().type('11111');
            cy.get('[name="city"]').clear().type('New York');

            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains("O'Reilly", { timeout: 10000 });
        });

        it('handles unicode characters', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('Société Française SAS');
            cy.selectCountry('client-country-select', 'France');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('FR12345678901');
            cy.get('[data-cy="client-identifier-VAT"]').clear().type('FR12345678901');
            cy.get('[name="contactEmail"]').clear().type('contact@societe.fr');
            cy.get('[name="address"]').clear().type('1 Rue de la Paix');
            cy.get('[name="postalCode"]').clear().type('75001');
            cy.get('[name="city"]').clear().type('Paris');

            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('Société Française', { timeout: 10000 });
        });

        // USER DECISION (2026-09-01, TODO_ISSUES.md "SIRET vs SIREN sur la facture", now RÉSOLU) —
        // `country-identifiers/data/fr.json`'s LEGAL_ID field accepts EITHER a 9-digit SIREN or a
        // 14-digit SIRET (see that file's own `notes`). Every OTHER FR fixture in this spec types a
        // 14-digit-shaped value (unaffected by the decision — both lengths pass); this is the one
        // that proves the 9-digit SIREN saves too, at the screen.
        it('accepts a bare 9-digit SIREN for a French company client (SIREN or SIRET, decision 2026-09-01)', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('SIREN Seul SARL');
            cy.selectCountry('client-country-select', 'France');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('123456789');
            cy.get('[name="contactEmail"]').clear().type('contact@siren-seul.fr');
            cy.get('[name="address"]').clear().type('2 Rue de la Paix');
            cy.get('[name="postalCode"]').clear().type('75001');
            cy.get('[name="city"]').clear().type('Paris');

            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('SIREN Seul', { timeout: 10000 });
        });

        it('accepts valid EU VAT format', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[name="name"]').clear().type('German Company GmbH');
            cy.selectCountry('client-country-select', 'Germany');
            cy.get('[data-cy="client-identifier-LEGAL_ID"]').clear().type('DE123456789');
            cy.get('[data-cy="client-identifier-VAT"]').clear().type('DE123456789');
            cy.get('[name="contactEmail"]').clear().type('contact@german.de');
            cy.get('[name="address"]').clear().type('Hauptstrasse 1');
            cy.get('[name="postalCode"]').clear().type('10115');
            cy.get('[name="city"]').clear().type('Berlin');

            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.contains('German Company', { timeout: 10000 });
        });
    });

    // TODO_PRODUIT.md T4-a/T4-b — the Peppol scheme selector (`peppolSchemeId`,
    // client-upsert.tsx). Every label asserted below is quoted VERBATIM from the Peppol v9.7
    // Participant Identifier Schemes codelist (docs.peppol.eu/edelivery/codelists/) — see that
    // component's own inline comments for the exact source citation on each entry.
    describe('Peppol scheme selector (TODO_PRODUIT.md T4-a/b)', () => {
        it('T4-a: offers the 7 EAS the 2026-09-02 B2G audit added routing rules for, but this selector never offered', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="client-peppol-scheme-select"]').scrollIntoView().click();

            // b2g-routing/data/{ee,lt,lv,lu,cy,gr,mt}.json each cite the exact same string.
            cy.get('[data-cy="client-peppol-scheme-option-0191"]').should(
                'contain.text',
                '0191 — EE Company code',
            );
            cy.get('[data-cy="client-peppol-scheme-option-0200"]').should(
                'contain.text',
                '0200 — LT Legal entity code',
            );
            cy.get('[data-cy="client-peppol-scheme-option-0218"]').should(
                'contain.text',
                '0218 — LV Unified registration number',
            );
            cy.get('[data-cy="client-peppol-scheme-option-0240"]').should(
                'contain.text',
                '0240 — LU Register of legal persons',
            );
            // Cyprus/Greece/Malta have no dedicated business-register scheme in the codelist — only
            // their VAT scheme exists (each file's own notes).
            cy.get('[data-cy="client-peppol-scheme-option-9928"]').should(
                'contain.text',
                '9928 — CY VAT number',
            );
            cy.get('[data-cy="client-peppol-scheme-option-9933"]').should(
                'contain.text',
                '9933 — GR VAT number',
            );
            cy.get('[data-cy="client-peppol-scheme-option-9943"]').should(
                'contain.text',
                '9943 — MT VAT number',
            );
        });

        it('T4-b: 0106 is labelled NL KVK (was wrongly "DK CVR"), and the real Danish CVR, 0184, is now offered', () => {
            cy.visit('/clients');
            cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');

            cy.get('[data-cy="client-peppol-scheme-select"]').scrollIntoView().click();

            // 0106 = "Vereniging van Kamers van Koophandel en Fabrieken in Nederland" (NL, the KVK)
            // in the codelist — never Danish. Re-verified live against the v9.7 codelist on
            // 2026-09-03 (see client-upsert.tsx's own comment for the full citation).
            cy.get('[data-cy="client-peppol-scheme-option-0106"]')
                .should('contain.text', '0106 — NL KVK')
                .and('not.contain.text', 'DK');
            // 0184 = "The Danish Business Authority - CVR-number (DK:CVR)" — the REAL Danish CVR.
            cy.get('[data-cy="client-peppol-scheme-option-0184"]').should('contain.text', '0184 — DK CVR');
        });
    });

    describe('Search Clients', () => {
        it('searches for a client by name', () => {
            cy.visit('/clients');
            cy.wait(2000);
            cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', { timeout: 10000 }).type('ACME');
            cy.wait(500);
            cy.contains('ACME Corporation');
        });

        it('searches for a client by email', () => {
            cy.visit('/clients');
            cy.wait(2000);
            cy.get('input[placeholder*="earch"], input[placeholder*="echerch"]', { timeout: 10000 }).type('jane.doe');
            cy.wait(500);
            cy.contains('Jane');
        });
    });

    describe('View Client Details', () => {
        it('views a client details', () => {
            cy.visit('/clients');
            cy.wait(2000);
            cy.get('[data-cy="view-client-button-jane.doe@freelance.org"]').click();
            cy.contains('Jane Doe');
            cy.contains('jane.doe@freelance.org');
        });
    });

    describe('Edit Clients', () => {
        it('edits an existing client', () => {
            cy.visit('/clients');
            cy.wait(2000);

            cy.get('[data-cy="edit-client-button-jane.doe@freelance.org"]').click();

            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="description"]').clear().type('A global technology leader');
            cy.get('[data-cy="client-submit"]').click();

            cy.get('[data-cy="client-dialog"]').should('not.exist');
            cy.wait(2000);

            cy.get('[data-cy="edit-client-button-jane.doe@freelance.org"]').click();
            cy.wait(2000);
            cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should('be.visible');
            cy.get('[name="description"]').should('have.value', 'A global technology leader');

            cy.get('[data-cy="client-cancel"]').click();
        });
    });

    describe('Delete Clients', () => {
        it('deletes a client', () => {
            cy.visit('/clients');
            cy.wait(2000);

            cy.get('[data-cy="delete-client-button-contact@german.de"]').click();

            cy.get('[data-cy="confirm-delete-client-button"]', { timeout: 5000 }).should('be.visible');
            cy.get('[data-cy="confirm-delete-client-button"]').click();

            cy.wait(2000);
            cy.get('[data-cy="client-status-inactive-contact@german.de"]').should('exist');
        });
    });
});
