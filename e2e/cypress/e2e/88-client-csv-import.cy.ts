export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Issue #204 - client CSV import.
 *
 * `ClientImportDialog` (frontend/src/pages/(app)/clients/_components/client-import-dialog.tsx) drives
 * `POST /clients/import/preview` then `POST /clients/import` (backend
 * `backend/src/modules/clients/import/`). This spec exercises the real pipeline end to end: template
 * download, a mixed file (valid / rejected-by-country-identifier / duplicate), the preview table,
 * confirming nothing was written before that point, the confirm itself, the result screen, and the
 * three encoding fixtures (semicolon, Windows-1252, UTF-8-with-BOM) landing with accented names
 * intact.
 */

const api = Cypress.env("apiUrl") || "http://localhost:4000";

function countClients() {
	return cy.request({ method: "GET", url: `${api}/api/clients?page=1` }).then((res) => res.body.clients.length);
}

describe("Client CSV import", () => {
	beforeEach(() => {
		cy.resetAndSeed();
		cy.login();
		cy.visit("/clients");
	});

	it("downloads the template with the expected header line", () => {
		cy.request({ method: "GET", url: `${api}/api/clients/import/template` }).then((res) => {
			expect(res.status).to.eq(200);
			const firstLine = (res.body as string).split(/\r\n|\n/)[0];
			expect(firstLine).to.contain("type");
			expect(firstLine).to.contain("name");
			expect(firstLine).to.contain("contactEmail");
			expect(firstLine).to.contain("identifier:VAT");
		});
	});

	it("previews a mixed file (valid, rejected, duplicate), writes nothing until confirmed, then imports", () => {
		// Row 7 of mixed.csv matches THIS pre-existing client by email - kept separate from the
		// dedicated "existing duplicate" test below so the preview screenshot and this test can show
		// BOTH duplicate kinds (within-file and existing-client) side by side, worded differently.
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				type: "COMPANY",
				name: "Existing Match Co",
				contactEmail: "existingmatch@example.com",
				address: "1 Existing Street",
				postalCode: "75000",
				city: "Paris",
				country: "France",
				countryCode: "FR",
				currency: "EUR",
				isActive: true,
			},
		}).then((res) => {
			expect(res.status).to.be.oneOf([200, 201]);
		});

		countClients().then((before) => {
			cy.get('[data-cy="clients-import-button"]').click();
			cy.get('[data-cy="clients-import-dialog"]', { timeout: 10000 }).should("be.visible");

			cy.get('[data-cy="clients-import-template-link"]').should("be.visible");

			cy.get('[data-cy="clients-import-file-input"]').selectFile(
				"cypress/fixtures/clients-import/mixed.csv",
				{ force: true },
			);

			cy.get('[data-cy="clients-import-preview"]', { timeout: 15000 }).should("be.visible");
			cy.get('[data-cy="clients-import-summary-valid"]').should("contain.text", "1");
			cy.get('[data-cy="clients-import-summary-rejected"]').should("contain.text", "3");
			cy.get('[data-cy="clients-import-summary-duplicates"]').should("contain.text", "2");

			// Row 3 (Missing Siret Co) is rejected for its missing FR identifier - country-specific
			// rejection, the case most likely to drift from the wizard's own rule.
			cy.get('[data-cy="clients-import-row-3"]').should("contain.text", "Rejected");
			cy.get('[data-cy="clients-import-row-3"]').should("contain.text", "SIREN");
			// Row 4 repeats row 2's email - the WITHIN-FILE duplicate rule, worded against the FILE.
			cy.get('[data-cy="clients-import-row-4"]').should("contain.text", "Duplicate");
			cy.get('[data-cy="clients-import-row-4"]').should(
				"contain.text",
				"Same email as row 2 of this file",
			);
			cy.get('[data-cy="clients-import-row-2"]').should("contain.text", "Will be created");

			// Row 5 has `country=France` and NO `countryCode` at all - a shape the wizard itself can
			// never produce (CountrySelect always sets both together). Before the country-resolution
			// fix, the required-identifiers lookup silently found nothing for an unresolved country
			// and let this row through; it must now be rejected with the SAME "SIREN / SIRET" message
			// the wizard shows for row 3.
			cy.get('[data-cy="clients-import-row-5"]').should("contain.text", "Rejected");
			cy.get('[data-cy="clients-import-row-5"]').should("contain.text", "SIREN");

			// Row 6's `type` column reads "Individuel" - not a value the wizard's own picker could
			// ever produce (COMPANY/INDIVIDUAL only). It must be rejected naming the column and the
			// value, never silently treated as COMPANY. The FULL reason must be readable, not clipped.
			cy.get('[data-cy="clients-import-row-6"]').should("contain.text", "Rejected");
			cy.get('[data-cy="clients-import-row-6"]').should(
				"contain.text",
				'Unknown type: "Individuel" (column "type", expected COMPANY or INDIVIDUAL).',
			);

			// Row 7 matches the EXISTING client seeded above by email - worded against the EXISTING
			// record, distinct from row 4's within-file wording.
			cy.get('[data-cy="clients-import-row-7"]').should("contain.text", "Duplicate");
			cy.get('[data-cy="clients-import-row-7"]').should(
				"contain.text",
				'Same email as existing client "Existing Match Co"',
			);

			// Nothing written yet - checked against the real API, not just the dialog's own state.
			countClients().then((duringPreview) => {
				expect(duringPreview).to.eq(before);
			});

			cy.get('[data-cy="clients-import-confirm-button"]').click();
			cy.get('[data-cy="clients-import-result"]', { timeout: 15000 }).should("be.visible");
			cy.get('[data-cy="clients-import-result-created"]').should("contain.text", "1");
			cy.get('[data-cy="clients-import-result-duplicates"]').should("contain.text", "2");
			cy.get('[data-cy="clients-import-result-rejected"]').should("contain.text", "3");
			cy.get('[data-cy="clients-import-close-button"]').click();

			countClients().then((after) => {
				expect(after).to.eq(before + 1);
			});
			cy.get('[data-cy="clients-list"]').should("contain.text", "CSV Import Co");
		});
	});

	it("round-trips its own downloaded template unchanged (the formula-injection guard must be undone on import)", () => {
		// `client-import-template.ts`'s example phone is written `'+33 1 23 45 67 89` - `toCsvLine`'s
		// own spreadsheet-formula guard prefixing an apostrophe to a value starting with `+`. Uploading
		// the SAME downloaded file back must NOT fail the wizard's phone regex on that leading `'`.
		cy.request({ method: "GET", url: `${api}/api/clients/import/template` }).then((res) => {
			const csv = res.body as string;
			expect(csv).to.contain("'+33");

			cy.get('[data-cy="clients-import-button"]').click();
			cy.get('[data-cy="clients-import-file-input"]').selectFile(
				{ contents: Cypress.Buffer.from(csv), fileName: "clients-import-template.csv", mimeType: "text/csv" },
				{ force: true },
			);
			cy.get('[data-cy="clients-import-preview"]', { timeout: 15000 }).should("be.visible");
			cy.get('[data-cy="clients-import-row-2"]').should("contain.text", "Will be created");
			cy.get('[data-cy="clients-import-summary-rejected"]').should("contain.text", "0");
		});
	});

	it("flags a row matching an EXISTING client (not just a within-file one) as a duplicate", () => {
		// The wizard's own duplicate rule (`ClientsService.findDuplicates`): same `contactEmail`
		// case-insensitive, OR same `name` + same `country` case-insensitive. Reused verbatim here so
		// an import skips exactly what the create wizard would already have warned about.
		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				type: "COMPANY",
				name: "Preexisting Duplicate Co",
				contactEmail: "preexisting@example.com",
				address: "1 Existing Street",
				postalCode: "75000",
				city: "Paris",
				country: "France",
				countryCode: "FR",
				currency: "EUR",
				isActive: true,
			},
		}).then((res) => {
			expect(res.status).to.be.oneOf([200, 201]);
		});

		const csv =
			"type,name,contactEmail,address,postalCode,city,country,countryCode,currency,identifier:LEGAL_ID\r\n" +
			"COMPANY,Preexisting Duplicate Co,preexisting@example.com,2 New Street,75001,Paris,France,FR,EUR,552100554\r\n";

		cy.get('[data-cy="clients-import-button"]').click();
		cy.get('[data-cy="clients-import-file-input"]').selectFile(
			{ contents: Cypress.Buffer.from(csv), fileName: "existing-duplicate.csv", mimeType: "text/csv" },
			{ force: true },
		);
		cy.get('[data-cy="clients-import-preview"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="clients-import-summary-duplicates"]').should("contain.text", "1");
		cy.get('[data-cy="clients-import-row-2"]').should("contain.text", "Duplicate");
		cy.get('[data-cy="clients-import-row-2"]').should("contain.text", "Preexisting Duplicate Co");
	});

	it("imports a semicolon-separated file", () => {
		cy.get('[data-cy="clients-import-button"]').click();
		cy.get('[data-cy="clients-import-file-input"]').selectFile(
			"cypress/fixtures/clients-import/semicolon.csv",
			{ force: true },
		);
		cy.get('[data-cy="clients-import-preview"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="clients-import-summary-valid"]').should("contain.text", "1");
		cy.get('[data-cy="clients-import-confirm-button"]').click();
		cy.get('[data-cy="clients-import-result-created"]', { timeout: 15000 }).should("contain.text", "1");
		cy.get('[data-cy="clients-import-close-button"]').click();
		cy.get('[data-cy="clients-list"]').should("contain.text", "Semicolon Import Co");
	});

	it("imports a Windows-1252 file, accented characters arriving intact", () => {
		cy.get('[data-cy="clients-import-button"]').click();
		cy.get('[data-cy="clients-import-file-input"]').selectFile(
			"cypress/fixtures/clients-import/windows-1252.csv",
			{ force: true },
		);
		cy.get('[data-cy="clients-import-preview"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="clients-import-row-2"]').should("contain.text", "Société Générale");
		cy.get('[data-cy="clients-import-confirm-button"]').click();
		cy.get('[data-cy="clients-import-result-created"]', { timeout: 15000 }).should("contain.text", "1");
		cy.get('[data-cy="clients-import-close-button"]').click();
		cy.get('[data-cy="clients-list"]').should("contain.text", "Société Générale");
	});

	it("imports a UTF-8-with-BOM file, the BOM never leaking into the first header/cell", () => {
		cy.get('[data-cy="clients-import-button"]').click();
		cy.get('[data-cy="clients-import-file-input"]').selectFile(
			"cypress/fixtures/clients-import/utf8-bom.csv",
			{ force: true },
		);
		cy.get('[data-cy="clients-import-preview"]', { timeout: 15000 }).should("be.visible");
		cy.get('[data-cy="clients-import-summary-valid"]').should("contain.text", "1");
		cy.get('[data-cy="clients-import-row-2"]').should("contain.text", "Bom Import Co");
		cy.get('[data-cy="clients-import-confirm-button"]').click();
		cy.get('[data-cy="clients-import-result-created"]', { timeout: 15000 }).should("contain.text", "1");
		cy.get('[data-cy="clients-import-close-button"]').click();
		cy.get('[data-cy="clients-list"]').should("contain.text", "Bom Import Co");
	});
});
