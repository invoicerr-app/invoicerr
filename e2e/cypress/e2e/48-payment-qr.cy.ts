export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * SEPA / EPC069-12 payment QR ("GiroCode") on the PDF — TODO_FEATURES.md rank 8 (⚡).
 *
 * The QR's exact CONTENT (the EPC069-12 v002 field order, the space-free IBAN, the `EUR12.34`
 * amount, the ref. = invoice number, the bounds/truncations, the IBAN/EUR/type/amount guards)
 * is proven in jest — `rendering/sepa-qr.spec.ts`, `render-html.spec.ts`, `render-instance-pdf.spec.ts`.
 * Here we prove the end-to-end WIRING through the REAL pipeline (endpoint → renderDocumentHtml →
 * puppeteer): an invoice PDF EMBEDS the QR when the company has an IBAN AND the invoice is in
 * EUR, and does NOT embed it otherwise (no IBAN — acceptance criterion "absent when iban is null" —,
 * or a non-EUR currency — SEPA only moves euros).
 *
 * This is measured by the PDF's SIZE: the QR's PNG image adds hundreds of bytes that no other
 * difference can explain — the two compared invoices are created identically (same client,
 * same lines, same dates) and the cuid id has a fixed length. A QR inside a binary PDF cannot be
 * decoded from Cypress; size is the robust signal, and the content is covered in jest.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// Valid example IBAN (the same one as sepa-qr.spec.ts's own happy path).
const TEST_IBAN = "FR1420041010050500013M02606";

function setCompanyIban(iban: string | null) {
	return cy
		.request({ method: "POST", url: `${api}/api/company/info`, body: { iban } })
		.then((res) => expect(res.status, "IBAN société enregistré").to.be.oneOf([200, 201]));
}

function createClient() {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "QR Client SARL",
				contactEmail: "qr-client@example.com",
				currency: "EUR",
				country: "FR",
				address: "1 Rue du QR",
				city: "Paris",
				postalCode: "75001",
				isActive: true,
				type: "COMPANY",
				identifiers: [{ scheme: "LEGAL_ID", value: "123456789" }],
			},
		})
		.its("body.id");
}

function createInvoiceDraft(clientId: string, currency: string) {
	return cy
		.request({
			method: "POST",
			url: `${api}/api/documents/types/invoice/actions/save-draft`,
			body: {
				data: {
					client: clientId,
					issueDate: "2026-08-30",
					dueDate: "2026-09-30",
					currency,
					lines: [{ description: "Consulting", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" }],
				},
			},
		})
		.then((saved) => {
			const id = saved.body?.document?.id as string;
			expect(id, "brouillon de facture créé").to.be.a("string");
			return id;
		});
}

/** Fetches the PDF (binary), verifies it is indeed a PDF, and returns its size in bytes. */
function pdfSize(id: string): Cypress.Chainable<number> {
	return cy
		.request({ url: `${api}/api/documents/${id}/pdf?typeId=invoice`, encoding: "binary" })
		.then((res) => {
			expect(res.status, "PDF rendu").to.eq(200);
			expect(res.headers["content-type"]).to.include("application/pdf");
			const magic = String.fromCharCode(
				res.body.charCodeAt(0),
				res.body.charCodeAt(1),
				res.body.charCodeAt(2),
				res.body.charCodeAt(3),
			);
			expect(magic, "octets magiques %PDF").to.eq("%PDF");
			return res.body.length as number;
		});
}

describe("SEPA payment QR on the PDF — end-to-end wiring", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
	});

	it("EUR + IBAN embeds the QR; without an IBAN the PDF doesn't embed it (PDF size)", () => {
		createClient().then((clientId: string) => {
			// The freshly seeded company has NO IBAN at all → no QR (criterion "absent when iban is null").
			createInvoiceDraft(clientId, "EUR").then((idNoIban) => {
				pdfSize(idNoIban).then((sizeNoIban) => {
					// An IBAN is now set → the SAME invoice (identically) embeds the QR.
					setCompanyIban(TEST_IBAN);
					createInvoiceDraft(clientId, "EUR").then((idIban) => {
						pdfSize(idIban).then((sizeWithIban) => {
							cy.log(`sans IBAN=${sizeNoIban} o | avec IBAN=${sizeWithIban} o`);
							expect(
								sizeWithIban,
								"le PNG du QR ajoute des octets que seule sa présence explique",
							).to.be.greaterThan(sizeNoIban + 100);
						});
					});
				});
			});
		});
	});

	it("a non-EUR invoice never embeds the QR, even with an IBAN set", () => {
		// The IBAN stays set from the previous test; it is set again to make this test self-contained.
		setCompanyIban(TEST_IBAN);
		createClient().then((clientId: string) => {
			createInvoiceDraft(clientId, "USD").then((idUsd) => {
				pdfSize(idUsd).then((sizeUsd) => {
					createInvoiceDraft(clientId, "EUR").then((idEur) => {
						pdfSize(idEur).then((sizeEur) => {
							cy.log(`USD (sans QR)=${sizeUsd} o | EUR (QR)=${sizeEur} o`);
							expect(
								sizeEur,
								"seule l'EUR embarque le QR ; l'USD ne le déclenche jamais",
							).to.be.greaterThan(sizeUsd + 100);
						});
					});
				});
			});
		});
	});
});
