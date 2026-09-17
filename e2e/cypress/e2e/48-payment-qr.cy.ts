export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * SEPA / EPC069-12 payment QR ("GiroCode") on the PDF.
 *
 * The QR's exact CONTENT (the EPC069-12 v002 field order, the space-free IBAN, the `EUR12.34`
 * amount, the ref. = invoice number, the bounds/truncations, the IBAN/EUR/type/amount guards)
 * is proven in jest — `rendering/sepa-qr.spec.ts`, `render-html.spec.ts`, `render-instance-pdf.spec.ts`.
 * Here we prove the end-to-end WIRING through the REAL pipeline (endpoint → renderDocumentHtml →
 * Chromium): an invoice PDF EMBEDS the QR when the company has an IBAN AND the invoice is in
 * EUR, and does NOT embed it otherwise (no IBAN — acceptance criterion "absent when iban is null" —,
 * or a non-EUR currency — SEPA only moves euros) — proven by actually DECODING the QR
 * (`cy.task("decodeSepaQrFromPdf", ...)`, `pdf-lib` + `jsQR` in the Node plugin process — see
 * `cypress.config.ts`'s own header on that task) and reading its own IBAN/amount/reference fields
 * back, not by a PDF byte-count delta: a wrong IBAN, a swapped net/gross amount, or a missing
 * reference would all still add "hundreds of bytes no other difference explains" and pass a
 * size-only check identically.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// Valid example IBAN (the same one as sepa-qr.spec.ts's own happy path).
const TEST_IBAN = "FR1420041010050500013M02606";

/** EPC069-12 v002's own field order (`sepa-qr.ts#buildEpcPayload`'s own header) — named indices into
 *  the LF-split decoded payload, so the test below reads "the IBAN field" rather than a bare `[6]`. */
const EPC_FIELD = {
	beneficiaryName: 5,
	iban: 6,
	amount: 7,
	unstructuredRemittance: 10,
} as const;

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

/** Fetches the PDF (binary) and verifies it is indeed a PDF, base64-encoded (Cypress tasks only
 *  accept JSON-serializable arguments — same convention `cypress.config.ts`'s own `extractPdfText`
 *  documents). */
function fetchPdfBase64(id: string): Cypress.Chainable<string> {
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
			return Cypress.Buffer.from(res.body as string, "binary").toString("base64");
		});
}

/** The invoice's own PDF, decoded into every embedded SEPA QR payload it carries — see
 *  `cypress.config.ts`'s own `decodeSepaQrFromPdf` header. Zero entries is a legitimate, asserted
 *  outcome (no IBAN, or a non-EUR currency), never an error. */
function decodeSepaQrCodes(id: string): Cypress.Chainable<string[]> {
	return fetchPdfBase64(id).then((base64) => cy.task<string[]>("decodeSepaQrFromPdf", base64));
}

describe("SEPA payment QR on the PDF — end-to-end wiring", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
	});

	it("EUR + IBAN embeds a QR carrying the RIGHT IBAN and amount; without an IBAN the PDF embeds none", () => {
		createClient().then((clientId: string) => {
			// The freshly seeded company has NO IBAN at all → no QR (criterion "absent when iban is null").
			createInvoiceDraft(clientId, "EUR").then((idNoIban) => {
				decodeSepaQrCodes(idNoIban).then((codesNoIban) => {
					expect(codesNoIban, "aucun QR sans IBAN").to.have.length(0);

					// An IBAN is now set → the SAME invoice (identically) embeds the QR.
					setCompanyIban(TEST_IBAN);
					createInvoiceDraft(clientId, "EUR").then((idIban) => {
						decodeSepaQrCodes(idIban).then((codesWithIban) => {
							expect(codesWithIban, "un QR, une fois l'IBAN configuré").to.have.length(1);
							const fields = codesWithIban[0].split("\n");
							expect(fields[EPC_FIELD.iban], "le QR porte le bon IBAN, sans espace").to.eq(TEST_IBAN);
							// 1 jour à 1000 net, TVA 20 % → 1200.00 brut (compute-totals.ts) — le montant du QR
							// est TOUJOURS le brut, jamais le net (sepa-qr.ts#BuildEpcPayloadInput.amountMinor).
							expect(
								fields[EPC_FIELD.amount],
								"le QR demande le TTC, pas le HT — inverser les deux resterait indétecté par une simple taille de PDF",
							).to.eq("EUR1200.00");
						});
					});
				});
			});
		});
	});

	it("a non-EUR invoice never embeds a QR, even with an IBAN set", () => {
		// The IBAN stays set from the previous test; it is set again to make this test self-contained.
		setCompanyIban(TEST_IBAN);
		createClient().then((clientId: string) => {
			createInvoiceDraft(clientId, "USD").then((idUsd) => {
				decodeSepaQrCodes(idUsd).then((codesUsd) => {
					expect(codesUsd, "SEPA ne bouge que des euros — aucun QR pour l'USD").to.have.length(0);

					createInvoiceDraft(clientId, "EUR").then((idEur) => {
						decodeSepaQrCodes(idEur).then((codesEur) => {
							expect(codesEur, "seule l'EUR embarque le QR").to.have.length(1);
						});
					});
				});
			});
		});
	});

	it("the QR's own reference is the invoice's REAL display number, once sent — never a stale or empty one", () => {
		setCompanyIban(TEST_IBAN);
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
		}).then((res) => expect(res.status, "transport email configuré").to.be.oneOf([200, 201]));

		createClient().then((clientId: string) => {
			createInvoiceDraft(clientId, "EUR").then((id) => {
				cy.request({
					method: "POST",
					url: `${api}/api/documents/types/invoice/actions/send`,
					body: {
						documentId: id,
						data: {
							client: clientId,
							issueDate: "2026-08-30",
							dueDate: "2026-09-30",
							currency: "EUR",
							lines: [{ description: "Consulting", quantity: 1, unit: "day", unitPrice: 1000, vatRate: "20" }],
						},
					},
				}).then((res) => expect(res.status, "envoi accepté").to.be.oneOf([200, 201]));

				cy.waitForDocumentStatus(`${api}/api/documents/${id}?typeId=invoice`, ["sent"]).then((doc) => {
					expect(doc.displayNumber, "la facture envoyée porte un numéro réel").to.be.a("string");

					decodeSepaQrCodes(id).then((codes) => {
						expect(codes, "un QR sur la facture envoyée").to.have.length(1);
						const fields = codes[0].split("\n");
						expect(
							fields[EPC_FIELD.unstructuredRemittance],
							"la référence du QR est le VRAI numéro de la facture, jamais vide ni un id interne",
						).to.eq(doc.displayNumber);
					});
				});
			});
		});
	});
});
