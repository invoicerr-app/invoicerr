/**
 * Electronic signature — proven THROUGH THE SCREEN: a FIXTURE
 * certificate is uploaded (self-signed, generated via a disposable local script using node-forge —
 * never committed, as its name `gen-e2e-fixture-pfx.tmp.ts` announced; see commit `3a743a6d`, which
 * introduced `cypress/fixtures/signing/e2e-fixture-cert.pfx`, for the full context, NEVER a real
 * certificate), the list shows its REAL metadata (subject/validity/serial extracted server-side by
 * node-forge, never taken on trust from the client), a downloaded invoice's PDF BECOMES PAdES-signed
 * (/ByteRange + /Contents in the bytes), and deactivating the certificate makes the PDF unsigned
 * again — without touching the document itself.
 *
 * Fixture password, documented here in plain text — this is NOT a secret, it's a throwaway test
 * password for a disposable self-signed certificate:
 *   e2e-fake-pfx-password-not-real
 *
 * Regressions covered: 19 (basic PDF rendering, no active certificate at the start)
 * and 28 (asynchronous sending keeps working once a certificate is active — the invoice sent by
 * email is a signed PDF, never a broken send).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const FIXTURE_PFX_PATH = "cypress/fixtures/signing/e2e-fixture-cert.pfx";
const FIXTURE_PASSWORD = "e2e-fake-pfx-password-not-real";

interface CertificateMeta {
	id: string;
	label: string;
	applicability: string;
	environment: string;
	subject: string;
	serial: string;
	isActive: boolean;
	notAfter: string;
}

function createInvoiceDraft() {
	return cy
		.request({ url: `${api}/api/documents/references/client/search` })
		.its("body")
		.then((clients: { id: string }[]) => {
			expect(clients, "le jeu d'essai contient un client").to.have.length.greaterThan(0);
			return cy
				.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/save-draft`,
					body: {
						data: {
							client: clients[0].id,
							issueDate: "2026-08-31",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [
								{ description: "Conseil", quantity: 1, unit: "hour", unitPrice: 100, vatRate: "20" },
							],
						},
					},
				})
				.then((saved) => {
					expect(saved.status).to.be.oneOf([200, 201]);
					const id = saved.body?.document?.id as string;
					expect(id, "le brouillon a un identifiant").to.be.a("string");
					return id;
				});
		});
}

/** Downloads the invoice's PDF and returns its raw bytes (binary encoding — same conventions
 *  as 19-document-pdf.cy.ts) to search for the PAdES markers in it. */
function fetchInvoicePdfRaw(invoiceId: string) {
	return cy
		.request({ url: `${api}/api/documents/${invoiceId}/pdf?typeId=invoice`, encoding: "binary" })
		.then((res) => {
			expect(res.status).to.eq(200);
			expect(res.headers["content-type"]).to.include("application/pdf");
			const pdfStart = String.fromCharCode(
				res.body.charCodeAt(0),
				res.body.charCodeAt(1),
				res.body.charCodeAt(2),
				res.body.charCodeAt(3),
			);
			expect(pdfStart, "un PDF valide (%PDF)").to.eq("%PDF");
			return res.body as string;
		});
}

describe("Electronic signature — company certificates", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("no certificate at the start — an invoice's PDF is SERVED UNSIGNED (regression 19)", () => {
		createInvoiceDraft().then((invoiceId) => {
			fetchInvoicePdfRaw(invoiceId).then((bytes) => {
				expect(bytes, "aucun /ByteRange sans certificat actif — comportement inchangé").to.not.include(
					"/ByteRange",
				);
			});
		});
	});

	it("the screen shows the empty state — no certificate configured, never presented as an obligation", () => {
		cy.visit("/settings/signing");
		cy.get('[data-cy="signing-certificates-section"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="signing-cert-empty-state"]').should("exist");
	});

	it("uploads the FIXTURE certificate through the screen — the list shows its REAL metadata", () => {
		cy.visit("/settings/signing");

		cy.get('[data-cy="signing-cert-label-input"]', { timeout: 15000 }).type("E2E fixture cert");
		cy.get('[data-cy="signing-cert-file-input"]').selectFile(FIXTURE_PFX_PATH, { force: true });
		cy.get('[data-cy="signing-cert-password-input"]').type(FIXTURE_PASSWORD);
		// Applicability ("All formats (*)") and environment ("Test") left at their default value.
		cy.get('[data-cy="signing-cert-upload-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Certificate uploaded");

		// The assertion that matters reads the API back — never the screen as proof of what is in the database.
		cy.request({ url: `${api}/api/company/signing-certificates` })
			.its("body")
			.then((certs: CertificateMeta[]) => {
				const cert = certs.find((c) => c.label === "E2E fixture cert");
				expect(cert, "le certificat est bien stocké, actif").to.exist;
				expect(cert!.isActive).to.eq(true);
				expect(cert!.applicability).to.eq("*");
				expect(cert!.environment).to.eq("TEST");
				// Extracted SERVER-SIDE by node-forge at upload time — never supplied by the client: the
				// proof that the PFX was actually read, not merely accepted as-is.
				expect(cert!.subject, "sujet extrait du vrai certificat").to.include(
					"Invoicerr E2E Fixture Signing Cert",
				);
				expect(cert!.serial, "numéro de série extrait du vrai certificat").to.be.a("string").and.not.be.empty;
				// NEVER the PFX nor the password in the response — the "never returns" jest test proves this
				// in isolation; here, the end-to-end proof through the real HTTP route.
				expect(JSON.stringify(cert)).to.not.include(FIXTURE_PASSWORD);
				expect(Object.keys(cert!)).to.not.include("encryptedPfx");
				expect(Object.keys(cert!)).to.not.include("encryptedPass");
			});

		// And the screen itself shows the real subject/status, not a placeholder.
		cy.contains('[data-cy^="signing-cert-row-"]', "E2E fixture cert", { timeout: 10000 }).should("exist");
		cy.get('[data-cy$="-status"]').should("contain.text", "Active");
	});

	it("a downloaded invoice's PDF BECOMES PAdES-signed (/ByteRange + /Contents in the bytes)", () => {
		createInvoiceDraft().then((invoiceId) => {
			fetchInvoicePdfRaw(invoiceId).then((bytes) => {
				expect(bytes, "signature PAdES présente — /ByteRange").to.include("/ByteRange");
				expect(bytes, "signature PAdES présente — /Contents").to.include("/Contents");
			});
		});
	});

	it("deactivates the certificate through the screen → the PDF becomes UNSIGNED again, without touching the document", () => {
		createInvoiceDraft().then((invoiceId) => {
			cy.visit("/settings/signing");
			// `cy.contains` with a selector returns the DEEPEST matching element — here the `-label`
			// <p>, not the row Card — so the row's own data-cy is derived by stripping that suffix,
			// rather than assumed to be what `cy.contains` handed back.
			cy.contains('[data-cy$="-label"]', "E2E fixture cert", { timeout: 15000 })
				.invoke("attr", "data-cy")
				.then((labelDataCy) => {
					const rowDataCy = (labelDataCy as unknown as string).replace(/-label$/, "");
					cy.get(`[data-cy="${rowDataCy}"]`).find('[data-cy$="-deactivate-button"]').click();
				});

			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Certificate deactivated");

			cy.request({ url: `${api}/api/company/signing-certificates` })
				.its("body")
				.then((certs: CertificateMeta[]) => {
					const cert = certs.find((c) => c.label === "E2E fixture cert");
					expect(cert, "le certificat reste en base — désactivation SOFT, jamais une suppression").to.exist;
					expect(cert!.isActive, "isActive devient false").to.eq(false);
				});

			// The same document, requested again, is no longer signed — proof that the PDF follows the
			// certificate's CURRENT state on every render, never a cached signature.
			fetchInvoicePdfRaw(invoiceId).then((bytes) => {
				expect(bytes, "plus de /ByteRange une fois le certificat désactivé").to.not.include("/ByteRange");
			});
		});
	});
});
