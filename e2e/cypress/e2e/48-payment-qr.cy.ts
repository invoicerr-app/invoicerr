/**
 * QR de paiement SEPA / EPC069-12 (« GiroCode ») sur le PDF — TODO_FEATURES.md rang 8 (⚡).
 *
 * Le CONTENU exact du QR (l'ordre des champs EPC069-12 v002, l'IBAN sans espaces, le montant
 * `EUR12.34`, la réf. = numéro de facture, les bornes/troncatures, les gardes IBAN/EUR/type/montant)
 * est prouvé en jest — `rendering/sepa-qr.spec.ts`, `render-html.spec.ts`, `render-instance-pdf.spec.ts`.
 * Ici on prouve le CÂBLAGE bout-en-bout par le VRAI pipeline (endpoint → renderDocumentHtml →
 * puppeteer) : un PDF de facture EMBARQUE le QR quand la société a un IBAN ET que la facture est en
 * EUR, et NE l'embarque PAS sinon (pas d'IBAN — critère d'acceptation « absent si iban null » —, ou
 * devise non-EUR — SEPA ne déplace que de l'euro).
 *
 * On le mesure par la TAILLE du PDF : l'image PNG du QR ajoute des centaines d'octets qu'aucune autre
 * différence ne peut expliquer — les deux factures comparées sont créées à l'identique (même client,
 * mêmes lignes, mêmes dates) et l'id cuid est de longueur fixe. On ne peut pas décoder un QR dans un
 * PDF binaire depuis Cypress ; la taille est le signal robuste, et le contenu est couvert en jest.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// IBAN d'exemple valide (le même que le happy-path de sepa-qr.spec.ts).
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

/** Récupère le PDF (binaire), vérifie que c'est bien un PDF, et renvoie sa taille en octets. */
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

describe("QR de paiement SEPA sur le PDF — câblage bout-en-bout", () => {
	before(() => {
		cy.resetAndSeed();
	});
	beforeEach(() => {
		cy.login();
	});

	it("EUR + IBAN embarque le QR ; sans IBAN le PDF ne l'embarque pas (taille du PDF)", () => {
		createClient().then((clientId: string) => {
			// La société fraîchement semée n'a AUCUN IBAN → pas de QR (critère « absent si iban null »).
			createInvoiceDraft(clientId, "EUR").then((idNoIban) => {
				pdfSize(idNoIban).then((sizeNoIban) => {
					// On pose maintenant un IBAN → la MÊME facture (à l'identique) embarque le QR.
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

	it("une facture non-EUR n'embarque jamais le QR, même avec un IBAN posé", () => {
		// L'IBAN reste posé par le test précédent ; on le repose pour rendre ce test autonome.
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
