describe('Multi-Tenant System - Roles & Access Control', () => {
  beforeEach(() => {
    // Reset and login before each test
    cy.clearCookies();
    cy.clearLocalStorage();
  });

  describe('Company Switching', () => {
    it('should display company switcher for users with multiple companies', () => {
      // Login as multi-company user
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('multi@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Verify company switcher is visible
      cy.get('[data-testid="company-switcher"]', { timeout: 10000 }).should('be.visible');
      
      // Verify current company is highlighted
      cy.get('[data-testid="current-company-name"]').should('contain', 'Acme Corporation');
    });

    it('should switch between companies and update context', () => {
      // Login as multi-company user
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('multi@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Open company switcher
      cy.get('[data-testid="company-switcher"]', { timeout: 10000 }).click();
      
      // Select different company
      cy.get('[data-testid="company-option"]').contains('TechStart France').click();
      
      // Verify URL/context changes
      cy.get('[data-testid="current-company-name"]', { timeout: 10000 }).should('contain', 'TechStart France');
      
      // Verify dashboard updates with new company data
      cy.get('[data-testid="company-currency"]').should('contain', 'EUR');
    });

    it('should hide company switcher for single-company users', () => {
      // Login as single-company user
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('user.acme@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Company switcher should not be visible
      cy.get('[data-testid="company-switcher"]').should('not.exist');
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    it('should show admin features for ADMIN role', () => {
      // Login as ADMIN
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('admin.acme@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Navigate to settings
      cy.visit('/settings');
      
      // Verify "Invite User" button is visible
      cy.get('[data-testid="invite-user-button"]', { timeout: 10000 }).should('be.visible');
      
      // Verify "Manage Members" is visible
      cy.get('[data-testid="manage-members-link"]').should('be.visible');
      
      // Verify "Company Settings" is accessible
      cy.get('[data-testid="company-settings-section"]').should('be.visible');
    });

    it('should hide admin features for USER role', () => {
      // Login as USER
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('user.acme@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Navigate to settings
      cy.visit('/settings');
      
      // Verify "Invite User" button is hidden
      cy.get('[data-testid="invite-user-button"]').should('not.exist');
      
      // Verify "Manage Members" is hidden or disabled
      cy.get('[data-testid="manage-members-link"]').should('not.exist');
    });

    it('should show superadmin dashboard for SUPERADMIN role', () => {
      // Login as SUPERADMIN
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('superadmin@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Navigate to admin dashboard
      cy.visit('/admin');
      
      // Verify admin dashboard is accessible
      cy.get('[data-testid="admin-dashboard"]', { timeout: 10000 }).should('be.visible');
      
      // Verify all companies are listed
      cy.get('[data-testid="companies-list"]').should('be.visible');
      cy.get('[data-testid="company-row"]').should('have.length.at.least', 2);
      
      // Verify superadmin-only features
      cy.get('[data-testid="system-settings"]').should('be.visible');
      cy.get('[data-testid="user-management"]').should('be.visible');
    });

    it('should prevent non-superadmin from accessing admin dashboard', () => {
      // Login as regular ADMIN
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('admin.acme@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Try to access admin dashboard
      cy.visit('/admin');
      
      // Should be redirected or show access denied
      cy.get('[data-testid="access-denied"]', { timeout: 10000 })
        .or('body')
        .should('contain', 'Access Denied')
        .or('url')
        .should('not.include', '/admin');
    });
  });

  describe('Invitations with Company Context', () => {
    it('should create invitation linked to current company', () => {
      // Login as ADMIN
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('admin.acme@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Navigate to invitations
      cy.visit('/settings/invitations');
      
      // Generate invitation
      cy.contains('button', /generate|create/i, { timeout: 15000 }).click();
      
      // Verify code is generated
      cy.get('table tbody tr', { timeout: 10000 }).should('have.length.at.least', 1);
      cy.get('table tbody tr').first().find('td').first().invoke('text').as('invitationCode');
      
      // Verify company context is shown
      cy.get('[data-testid="invitation-company"]').should('contain', 'Acme Corporation');
    });

    it('should register user to correct company via invitation', () => {
      // Step 1: Create invitation as ADMIN
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('admin.techstart@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      cy.visit('/settings/invitations');
      cy.contains('button', /generate|create/i, { timeout: 15000 }).click();
      cy.wait(1000);
      
      // Get the invitation code
      cy.get('table tbody tr', { timeout: 10000 }).first().find('td').first().invoke('text').then((code) => {
        const invitationCode = code.trim();
        
        // Step 2: Logout and register with invitation
        cy.clearCookies();
        cy.visit('/auth/sign-up');
        
        cy.get('[data-cy="auth-invitation-code-input"]', { timeout: 10000 }).type(invitationCode);
        cy.get('[data-cy="auth-firstname-input"]').type('New');
        cy.get('[data-cy="auth-lastname-input"]').type('Employee');
        cy.get('[data-cy="auth-email-input"]').type('new.employee@test.com');
        cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
        cy.get('[data-cy="auth-submit-btn"]').click();
        
        // Should redirect to dashboard
        cy.url({ timeout: 30000 }).should('include', '/dashboard');
        
        // Verify user is in correct company context
        cy.get('[data-testid="current-company-name"]', { timeout: 10000 }).should('contain', 'TechStart France');
      });
    });

    it('should prevent USER from creating invitations', () => {
      // Login as USER
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('user.acme@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Navigate to settings
      cy.visit('/settings');
      
      // Verify invite button is not visible
      cy.get('[data-testid="invite-user-button"]').should('not.exist');
      
      // Try to access invite API directly
      cy.request({
        method: 'POST',
        url: '/api/invitations',
        failOnStatusCode: false,
        body: {
          companyId: 'test-company-id',
        },
      }).then((response) => {
        expect(response.status).to.be.oneOf([403, 401, 404]);
      });
    });

    it('should show correct company in invitation list', () => {
      // Login as SUPERADMIN
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('superadmin@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Navigate to invitations
      cy.visit('/settings/invitations');
      
      // Verify invitations show company context
      cy.get('table tbody tr', { timeout: 10000 }).should('exist');
      cy.get('table tbody tr').each(($row) => {
        cy.wrap($row).find('[data-testid="invitation-company"]').should('exist');
      });
    });
  });

  describe('Data Isolation Between Companies', () => {
    it('should isolate clients between companies', () => {
      // Login as user with access to multiple companies
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('multi@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // View clients in Acme
      cy.visit('/clients');
      cy.get('[data-testid="client-list"]', { timeout: 10000 }).should('be.visible');
      cy.get('[data-testid="client-row"]').should('have.length.at.least', 1);
      
      // Get first client name from Acme
      cy.get('[data-testid="client-row"]').first().find('[data-testid="client-name"]').invoke('text').as('acmeClient');
      
      // Switch to TechStart
      cy.get('[data-testid="company-switcher"]', { timeout: 10000 }).click();
      cy.get('[data-testid="company-option"]').contains('TechStart France').click();
      
      // Wait for context switch
      cy.get('[data-testid="current-company-name"]', { timeout: 10000 }).should('contain', 'TechStart France');
      
      // Navigate to clients again
      cy.visit('/clients');
      
      // Acme client should not be visible
      cy.get('@acmeClient').then((clientName) => {
        cy.get('[data-testid="client-list"]').should('not.contain', clientName);
      });
      
      // TechStart clients should be visible
      cy.get('[data-testid="client-row"]').should('have.length.at.least', 1);
    });

    it('should isolate invoices between companies', () => {
      // Login as user with access to multiple companies
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('multi@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // View invoices in Acme
      cy.visit('/invoices');
      cy.get('[data-testid="invoice-list"]', { timeout: 10000 }).should('be.visible');
      
      // Get invoice numbers from Acme
      cy.get('[data-testid="invoice-row"]').first().find('[data-testid="invoice-number"]').invoke('text').as('acmeInvoice');
      
      // Switch to TechStart
      cy.get('[data-testid="company-switcher"]', { timeout: 10000 }).click();
      cy.get('[data-testid="company-option"]').contains('TechStart France').click();
      
      // Wait for context switch
      cy.get('[data-testid="current-company-name"]', { timeout: 10000 }).should('contain', 'TechStart France');
      
      // Navigate to invoices
      cy.visit('/invoices');
      
      // Acme invoice should not be visible
      cy.get('@acmeInvoice').then((invoiceNumber) => {
        cy.get('[data-testid="invoice-list"]').should('not.contain', invoiceNumber);
      });
      
      // TechStart invoices should have different format (F- prefix)
      cy.get('[data-testid="invoice-row"]').first().find('[data-testid="invoice-number"]').should('contain', 'F-');
    });

    it('should maintain separate numbering sequences per company', () => {
      // Login as SUPERADMIN
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('superadmin@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Check Acme numbering
      cy.visit('/invoices');
      cy.get('[data-testid="invoice-row"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="invoice-number"]').first().should('contain', 'INV-');
      
      // Switch to TechStart
      cy.get('[data-testid="company-switcher"]', { timeout: 10000 }).click();
      cy.get('[data-testid="company-option"]').contains('TechStart France').click();
      cy.get('[data-testid="current-company-name"]', { timeout: 10000 }).should('contain', 'TechStart France');
      
      // Check TechStart numbering
      cy.visit('/invoices');
      cy.get('[data-testid="invoice-row"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="invoice-number"]').first().should('contain', 'F-');
      
      // Switch to Müller
      cy.get('[data-testid="company-switcher"]', { timeout: 10000 }).click();
      cy.get('[data-testid="company-option"]').contains('Müller GmbH').click();
      cy.get('[data-testid="current-company-name"]', { timeout: 10000 }).should('contain', 'Müller GmbH');
      
      // Check Müller numbering
      cy.visit('/invoices');
      cy.get('[data-testid="invoice-row"]', { timeout: 10000 }).should('exist');
      cy.get('[data-testid="invoice-number"]').first().should('contain', 'RE-');
    });
  });

  describe('Cross-Company Security', () => {
    it('should prevent accessing other company data via URL manipulation', () => {
      // Login as user who only has access to Acme
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('user.acme@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Try to access TechStart company data
      cy.visit('/invoices?company=techstart-france-id');
      
      // Should show access denied or redirect
      cy.get('[data-testid="access-denied"]', { timeout: 10000 })
        .or('[data-testid="not-found"]')
        .should('be.visible');
    });

    it('should verify user belongs to company before showing data', () => {
      // Login as multi-company user
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('multi@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Create an invoice in Acme
      cy.visit('/invoices');
      cy.get('[data-testid="create-invoice-button"]', { timeout: 10000 }).click();
      
      // Select a client
      cy.get('[data-testid="client-select"]', { timeout: 10000 }).click();
      cy.get('[data-testid="client-option"]').first().click();
      
      // Fill in invoice details
      cy.get('[data-testid="invoice-description"]').type('Test Invoice for Isolation');
      cy.get('[data-testid="add-item-button"]').click();
      cy.get('[data-testid="item-description-0"]').type('Test Service');
      cy.get('[data-testid="item-quantity-0"]').clear().type('1');
      cy.get('[data-testid="item-unit-price-0"]').clear().type('100');
      
      // Save invoice
      cy.get('[data-testid="save-invoice"]').click();
      cy.get('[data-testid="success-toast"]', { timeout: 10000 }).should('be.visible');
      
      // Get invoice ID
      cy.url().then((url) => {
        const invoiceId = url.split('/').pop();
        
        // Switch to TechStart
        cy.get('[data-testid="company-switcher"]', { timeout: 10000 }).click();
        cy.get('[data-testid="company-option"]').contains('TechStart France').click();
        cy.get('[data-testid="current-company-name"]', { timeout: 10000 }).should('contain', 'TechStart France');
        
        // Try to access Acme invoice from TechStart context
        cy.visit(`/invoices/${invoiceId}`);
        
        // Should show access denied
        cy.get('[data-testid="access-denied"]', { timeout: 10000 })
          .or('[data-testid="not-found"]')
          .should('be.visible');
      });
    });
  });

  describe('Settings Isolation', () => {
    it('should maintain separate settings per company', () => {
      // Login as multi-company user
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('multi@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Check Acme settings
      cy.visit('/settings');
      cy.get('[data-testid="currency-display"]', { timeout: 10000 }).should('contain', 'USD');
      cy.get('[data-testid="date-format-display"]').should('contain', 'MM/dd/yyyy');
      
      // Switch to TechStart
      cy.get('[data-testid="company-switcher"]', { timeout: 10000 }).click();
      cy.get('[data-testid="company-option"]').contains('TechStart France').click();
      cy.get('[data-testid="current-company-name"]', { timeout: 10000 }).should('contain', 'TechStart France');
      
      // Check TechStart settings
      cy.visit('/settings');
      cy.get('[data-testid="currency-display"]', { timeout: 10000 }).should('contain', 'EUR');
      cy.get('[data-testid="date-format-display"]').should('contain', 'dd/MM/yyyy');
    });

    it('should maintain separate payment methods per company', () => {
      // Login as multi-company user
      cy.visit('/auth/sign-in');
      cy.get('[data-cy="auth-email-input"]', { timeout: 10000 }).type('multi@test.com');
      cy.get('[data-cy="auth-password-input"]').type('Super_Secret_Password123!');
      cy.get('[data-cy="auth-submit-btn"]').click();
      cy.url({ timeout: 20000 }).should('include', '/dashboard');

      // Check Acme payment methods
      cy.visit('/settings/payment-methods');
      cy.get('[data-testid="payment-method-list"]', { timeout: 10000 }).should('be.visible');
      cy.get('[data-testid="payment-method-row"]').should('contain', 'Chase');
      
      // Switch to TechStart
      cy.get('[data-testid="company-switcher"]', { timeout: 10000 }).click();
      cy.get('[data-testid="company-option"]').contains('TechStart France').click();
      cy.get('[data-testid="current-company-name"]', { timeout: 10000 }).should('contain', 'TechStart France');
      
      // Check TechStart payment methods
      cy.visit('/settings/payment-methods');
      cy.get('[data-testid="payment-method-list"]', { timeout: 10000 }).should('be.visible');
      cy.get('[data-testid="payment-method-row"]').should('contain', 'IBAN');
      cy.get('[data-testid="payment-method-row"]').should('not.contain', 'Chase');
    });
  });
});
