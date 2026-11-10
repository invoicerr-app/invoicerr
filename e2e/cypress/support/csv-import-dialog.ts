/**
 * Shared steps for the two CSV import dialogs: the client import (`clients-import-*` data-cy
 * attributes) and the past-invoice import (`import-document-csv-*`). Both open a dialog, take a
 * CSV, show a preview with valid/rejected/duplicate counts, then a result with created/imported
 * counts. Only the prefix and the open button differ, so the flow lives here once instead of being
 * copied per spec.
 */

export type CsvImportFile =
	| string
	| { contents: Cypress.FileContents; fileName: string; mimeType?: string };

export interface CsvImportPreview {
	/** Vendor name the dialog recognised the export as, when the spec asserts it. */
	vendor?: string;
	valid?: string;
	rejected?: string;
	duplicates?: string;
	screenshot?: string;
}

export interface CsvImportResult {
	created?: string;
	imported?: string;
	rejected?: string;
	duplicates?: string;
	close?: boolean;
}

export function openCsvImportDialog(openButton: string, prefix: string): void {
	cy.get(`[data-cy="${openButton}"]`).click();
	cy.get(`[data-cy="${prefix}-dialog"]`, { timeout: 10000 }).should("be.visible");
}

export function uploadCsvImportFile(prefix: string, file: CsvImportFile): void {
	cy.get(`[data-cy="${prefix}-file-input"]`).selectFile(file, { force: true });
}

/** The past-invoice dialog uploads its original PDFs in the same request as the CSV. */
export function uploadInvoiceOriginals(path: string): void {
	cy.get('[data-cy="import-document-csv-files-input"]').selectFile(path, { force: true });
	cy.wait(500); // the file upload round-trip before the CSV itself is parsed against it
}

export function expectCsvImportPreview(prefix: string, expected: CsvImportPreview): void {
	cy.get(`[data-cy="${prefix}-preview"]`, { timeout: 15000 }).should("be.visible");

	if (expected.vendor) {
		cy.get(`[data-cy="${prefix}-vendor"]`, { timeout: 15000 }).should(
			"contain.text",
			expected.vendor,
		);
	}

	const counts = {
		valid: expected.valid,
		rejected: expected.rejected,
		duplicates: expected.duplicates,
	};
	for (const [kind, value] of Object.entries(counts)) {
		if (value !== undefined) {
			cy.get(`[data-cy="${prefix}-summary-${kind}"]`, { timeout: 15000 }).should(
				"contain.text",
				value,
			);
		}
	}

	if (expected.screenshot) cy.screenshot(expected.screenshot, { capture: "viewport" });
}

export function confirmCsvImport(prefix: string, expected: CsvImportResult): void {
	cy.get(`[data-cy="${prefix}-confirm-button"]`).click();
	cy.get(`[data-cy="${prefix}-result"]`, { timeout: 15000 }).should("be.visible");

	const counts = {
		created: expected.created,
		imported: expected.imported,
		rejected: expected.rejected,
		duplicates: expected.duplicates,
	};
	for (const [kind, value] of Object.entries(counts)) {
		if (value !== undefined) {
			cy.get(`[data-cy="${prefix}-result-${kind}"]`, { timeout: 15000 }).should(
				"contain.text",
				value,
			);
		}
	}

	if (expected.close) cy.get(`[data-cy="${prefix}-close-button"]`).click();
}

/** Finds the client a vendor export created by e-mail and asserts the country it kept. */
export function expectCreatedClientCountry(email: string, country: string): void {
	cy.request({ method: "GET", url: `${Cypress.env("apiUrl")}/api/clients?page=1` }).then((res) => {
		const created = (res.body.clients as { contactEmail: string; country: string }[]).find(
			(entry) => entry.contactEmail === email,
		);
		expect(created, "vendor client created").to.not.eq(undefined);
		expect(created?.country, "country cell kept").to.eq(country);
	});
}
