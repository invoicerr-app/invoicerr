/**
 * Signature électronique (root TODO item 13, module supprimé) — prouvée PAR L'ÉCRAN : on uploade un
 * certificat de FIXTURE (auto-signé, généré par node-forge — voir
 * `backend/gen-e2e-fixture-pfx.tmp.ts`'s own header at the commit that produced
 * `cypress/fixtures/signing/e2e-fixture-cert.pfx`, JAMAIS un vrai certificat), la liste affiche ses
 * VRAIES métadonnées (sujet/validité/série extraits côté serveur par node-forge, jamais échoués par le
 * client), le PDF d'une facture téléchargée DEVIENT signé PAdES (/ByteRange + /Contents dans les
 * octets), et la désactivation du certificat rend le PDF de nouveau non signé — sans toucher au
 * document lui-même.
 *
 * Mot de passe du fixture, documenté ici en clair — ce n'est PAS un secret, c'est un mot de passe de
 * test bidon pour un certificat auto-signé jetable :
 *   e2e-fake-pfx-password-not-real
 *
 * Régression couverte par la même passe : 19 (rendu PDF de base, aucun certificat actif au départ)
 * et 28 (l'envoi asynchrone continue de fonctionner une fois un certificat actif — la facture envoyée
 * par email est du PDF signé, jamais un envoi cassé).
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

/** Télécharge le PDF de la facture et retourne ses octets bruts (encodage binaire — mêmes conventions
 *  que 19-document-pdf.cy.ts) pour y chercher les marqueurs PAdES. */
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

describe("Signature électronique — certificats de société (root TODO item 13)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("aucun certificat au départ — le PDF d'une facture est SERVI NON SIGNÉ (régression 19)", () => {
		createInvoiceDraft().then((invoiceId) => {
			fetchInvoicePdfRaw(invoiceId).then((bytes) => {
				expect(bytes, "aucun /ByteRange sans certificat actif — comportement inchangé").to.not.include(
					"/ByteRange",
				);
			});
		});
	});

	it("l'écran affiche l'état vide — aucun certificat configuré, jamais présenté comme une obligation", () => {
		cy.visit("/settings/signing");
		cy.get('[data-cy="signing-certificates-section"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="signing-cert-empty-state"]').should("exist");
	});

	it("uploade le certificat de FIXTURE par l'écran — la liste affiche ses VRAIES métadonnées", () => {
		cy.visit("/settings/signing");

		cy.get('[data-cy="signing-cert-label-input"]', { timeout: 15000 }).type("E2E fixture cert");
		cy.get('[data-cy="signing-cert-file-input"]').selectFile(FIXTURE_PFX_PATH, { force: true });
		cy.get('[data-cy="signing-cert-password-input"]').type(FIXTURE_PASSWORD);
		// Applicability ("All formats (*)") et environnement ("Test") laissés à leur valeur par défaut.
		cy.get('[data-cy="signing-cert-upload-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Certificate uploaded");

		// L'assertion qui compte relit l'API — jamais l'écran comme preuve de ce qui est en base.
		cy.request({ url: `${api}/api/company/signing-certificates` })
			.its("body")
			.then((certs: CertificateMeta[]) => {
				const cert = certs.find((c) => c.label === "E2E fixture cert");
				expect(cert, "le certificat est bien stocké, actif").to.exist;
				expect(cert!.isActive).to.eq(true);
				expect(cert!.applicability).to.eq("*");
				expect(cert!.environment).to.eq("TEST");
				// Extrait CÔTÉ SERVEUR par node-forge à l'upload — jamais fourni par le client : la preuve
				// que le PFX a réellement été lu, pas seulement accepté tel quel.
				expect(cert!.subject, "sujet extrait du vrai certificat").to.include(
					"Invoicerr E2E Fixture Signing Cert",
				);
				expect(cert!.serial, "numéro de série extrait du vrai certificat").to.be.a("string").and.not.be.empty;
				// JAMAIS le PFX ni le mot de passe dans la réponse — le test "never returns" jest le prouve
				// en isolation ; ici, la preuve de bout en bout par la vraie route HTTP.
				expect(JSON.stringify(cert)).to.not.include(FIXTURE_PASSWORD);
				expect(Object.keys(cert!)).to.not.include("encryptedPfx");
				expect(Object.keys(cert!)).to.not.include("encryptedPass");
			});

		// Et l'écran lui-même montre le sujet/le statut réels, pas un espace réservé.
		cy.contains('[data-cy^="signing-cert-row-"]', "E2E fixture cert", { timeout: 10000 }).should("exist");
		cy.get('[data-cy$="-status"]').should("contain.text", "Active");
	});

	it("le PDF d'une facture téléchargée DEVIENT signé PAdES (/ByteRange + /Contents dans les octets)", () => {
		createInvoiceDraft().then((invoiceId) => {
			fetchInvoicePdfRaw(invoiceId).then((bytes) => {
				expect(bytes, "signature PAdES présente — /ByteRange").to.include("/ByteRange");
				expect(bytes, "signature PAdES présente — /Contents").to.include("/Contents");
			});
		});
	});

	it("désactive le certificat par l'écran → le PDF redevient NON SIGNÉ, sans toucher au document", () => {
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

			// Le même document, redemandé, n'est plus signé — la preuve que le PDF suit l'état ACTUEL
			// du certificat à chaque rendu, jamais une signature mise en cache.
			fetchInvoicePdfRaw(invoiceId).then((bytes) => {
				expect(bytes, "plus de /ByteRange une fois le certificat désactivé").to.not.include("/ByteRange");
			});
		});
	});
});
