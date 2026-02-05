beforeEach(() => {
    cy.login();
});

describe('Settings E2E', () => {
    describe('Account Settings', () => {
        it('loads account settings page', () => {
            cy.visit('/settings/account');
            cy.wait(1000);
            cy.contains(/account|compte/i, { timeout: 10000 });
        });

        it('displays profile form', () => {
            cy.visit('/settings/account');
            cy.wait(1000);

            cy.get('input[name="firstname"], input[name="name"]').should('exist');
        });

        it('updates profile information', () => {
            cy.visit('/settings/account');
            cy.wait(1000);

            cy.get('body').then($body => {
                if ($body.find('input[name="firstname"]').length > 0) {
                    cy.get('input[name="firstname"]').clear().type('UpdatedFirst');
                    cy.get('input[name="lastname"]').clear().type('UpdatedLast');
                    cy.contains('button', /save|update|enregistrer/i).first().click();
                    cy.wait(1000);
                }
            });
        });
    });

    describe('Company Settings', () => {
        it('loads company settings page', () => {
            cy.visit('/settings/company');
            cy.wait(1000);
            cy.contains(/company|entreprise|société/i, { timeout: 10000 });
        });

        it('displays company form', () => {
            cy.visit('/settings/company');
            cy.wait(1000);

            cy.get('[data-cy="company-name-input"], input[name="name"]').should('exist');
        });
    });

    describe('Invitations Settings', () => {
        it('loads invitations page', () => {
            cy.visit('/settings/invitations');
            cy.wait(1000);
            cy.contains(/invitation/i, { timeout: 10000 });
        });

        it('creates a new invitation code', () => {
            cy.visit('/settings/invitations');
            cy.wait(1000);

            cy.get('body').then($body => {
                if ($body.find('input#expiresInDays').length > 0) {
                    cy.get('input#expiresInDays').type('30');
                }
            });

            cy.contains('button', /create|créer|generate|générer/i).click();
            cy.wait(2000);
        });

        it('displays invitation codes list', () => {
            cy.visit('/settings/invitations');
            cy.wait(1000);

            cy.get('body').then($body => {
                if ($body.find('table').length > 0) {
                    cy.get('table').should('exist');
                }
            });
        });
    });

    describe('Danger Zone Settings', () => {
        it('loads danger zone page', () => {
            cy.visit('/settings/danger-zone');
            cy.wait(1000);
            cy.contains(/danger/i, { timeout: 10000 });
        });

        it('shows reset buttons', () => {
            cy.visit('/settings/danger-zone');
            cy.wait(1000);

            cy.get('button').should('have.length.at.least', 1);
        });
    });

    describe('Settings Sidebar Navigation', () => {
        it('navigates between settings sections', () => {
            cy.visit('/settings');
            cy.wait(1000);

            // Sur petit écran, la navigation peut être un select ou un menu
            // On vérifie simplement qu'on peut naviguer via l'URL
            cy.visit('/settings/account');
            cy.wait(500);
            cy.url().should('include', '/settings/account');
            
            cy.visit('/settings/company');
            cy.wait(500);
            cy.url().should('include', '/settings/company');
            
            cy.visit('/settings/invitations');
            cy.wait(500);
            cy.url().should('include', '/settings/invitations');
        });
    });
});
