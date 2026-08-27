/**
 * Company lookup — the country coverage contract.
 *
 * The capability matrix is asserted for EVERY country the backend knows about, not a
 * sample: that is the promise the feature makes (any country the compliance profiles
 * cover resolves with no credential configured), and it is the thing that silently
 * breaks when a provider is added, renamed or made credential-dependent.
 *
 * Nothing here touches a real business register. Capabilities are computed in-process,
 * and the lookup calls below are shaped so the identifier is rejected offline by the
 * provider's structural check — a CI job must never depend on INSEE or VIES being up.
 * The real registries are covered by the opt-in jest suite:
 *   COMPANY_LOOKUP_LIVE=1 npx jest company-lookup.live
 */

const apiUrl = Cypress.env('apiUrl') as string;

interface ProviderCapability {
    id: string;
    coverage: 'REGISTER' | 'PARTIAL';
    configured: boolean;
    requiresCredentials: boolean;
    schemes: string[];
    identifierLabel: string;
}

interface CountryCapability {
    countryCode: string;
    status: string;
    coverage: 'REGISTER' | 'PARTIAL';
    providers: ProviderCapability[];
    schemes: string[];
    identifierLabel?: string;
    note?: string;
}

/** Worldwide directories: they answer for any country, so they must always be tried last. */
const WORLDWIDE = ['gleif', 'peppol-directory'];

describe('Company lookup — capabilities', () => {
    it('serves every known country with a keyless provider', () => {
        cy.request(`${apiUrl}/api/company-lookup/capabilities`).then((response) => {
            expect(response.status).to.eq(200);
            const capabilities = response.body as CountryCapability[];

            // The compliance profiles cover ~106 jurisdictions; a sharp drop means a
            // registry regression, not a legitimate change.
            expect(capabilities.length).to.be.greaterThan(100);

            capabilities.forEach((capability) => {
                const where = capability.countryCode;
                expect(capability.status, `${where} status`).to.eq('AVAILABLE');
                expect(capability.coverage, `${where} coverage`).to.be.oneOf(['REGISTER', 'PARTIAL']);

                const usable = capability.providers.filter((p) => p.configured);
                expect(usable.length, `${where} has a usable provider`).to.be.greaterThan(0);
                expect(
                    usable.some((p) => !p.requiresCredentials),
                    `${where} works without credentials`,
                ).to.eq(true);

                // Partial coverage must say so — the UI shows this note when a lookup
                // comes up empty, so an unexplained country is a real defect.
                if (capability.coverage === 'PARTIAL') {
                    expect(capability.note, `${where} note`).to.be.a('string').and.not.be.empty;
                }

                const ids = capability.providers.map((p) => p.id);
                const firstWorldwide = ids.findIndex((id) => WORLDWIDE.includes(id));
                const lastNational = ids.reduce((last, id, i) => (WORLDWIDE.includes(id) ? last : i), -1);
                if (firstWorldwide >= 0 && lastNational >= 0) {
                    expect(firstWorldwide, `${where} tries its own register first`).to.be.greaterThan(
                        lastNational,
                    );
                }
            });
        });
    });

    it('describes one country the same way whether asked alone or in the list', () => {
        cy.request(`${apiUrl}/api/company-lookup/capabilities`).then((listResponse) => {
            const list = listResponse.body as CountryCapability[];
            const france = list.find((c) => c.countryCode === 'FR');
            expect(france, 'FR is present').to.exist;

            cy.request(`${apiUrl}/api/company-lookup/capabilities/fr`).then((single) => {
                expect(single.status).to.eq(200);
                expect(single.body).to.deep.equal(france);
                // France has its own register, so the prompt names the national identifier.
                expect(single.body.coverage).to.eq('REGISTER');
                expect(single.body.identifierLabel).to.match(/SIRET/);
            });
        });
    });

    it('is reachable without a session, because onboarding reads it before one settles', () => {
        cy.request(`${apiUrl}/api/company-lookup/capabilities/DE`).its('status').should('eq', 200);
    });

    it('keeps the lookup itself behind a session — it spends external API quota', () => {
        cy.request({
            url: `${apiUrl}/api/company-lookup?country=FR&value=55208131766522`,
            failOnStatusCode: false,
        })
            .its('status')
            .should('eq', 401);
    });
});

describe('Company lookup — query contract', () => {
    beforeEach(() => {
        cy.login();
    });

    it('rejects a malformed query before calling any registry', () => {
        cy.request({ url: `${apiUrl}/api/company-lookup?country=FR`, failOnStatusCode: false })
            .its('status')
            .should('eq', 400);

        cy.request({
            url: `${apiUrl}/api/company-lookup?country=FR&value=1&scheme=NOPE`,
            failOnStatusCode: false,
        })
            .its('status')
            .should('eq', 400);
    });

    it('answers an impossible identifier offline instead of asking the register', () => {
        // "abc" fails every French structural check, so no HTTP call leaves the process.
        cy.request(`${apiUrl}/api/company-lookup?country=FR&value=abc&scheme=LEGAL_ID`).then(
            (response) => {
                expect(response.status).to.eq(200);
                expect(response.body.found).to.eq(false);
                expect(response.body.error).to.eq('INVALID_IDENTIFIER');
                expect(response.body.message).to.match(/SIRET/);
            },
        );
    });
});

describe('Company lookup — client form', () => {
    beforeEach(() => {
        cy.login();
    });

    it('offers the lookup on the identifier the country register accepts', () => {
        cy.visit('/clients');
        cy.contains('button', /add|new|créer|ajouter/i, { timeout: 10000 }).click();
        cy.wait(500);

        cy.selectCountry('client-country-select', 'France');
        cy.wait(1000);

        cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).should('exist');
        cy.get('[data-cy="client-company-lookup"]')
            .should('exist')
            .first()
            .invoke('attr', 'title')
            .should('match', /SIRET/);
    });
});
