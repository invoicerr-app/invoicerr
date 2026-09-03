/**
 * Root TODO item 18 ("réception de factures") — prouvé PAR L'ÉCRAN, comme 17-document-descriptor.cy.ts
 * et le reste de cette suite : les ACTIONS passent par l'interface, les ASSERTIONS de contenu (le
 * fichier téléchargé est-il exactement celui uploadé ?) passent par l'API — mêmes conventions que
 * 33-signing-certificates.cy.ts (upload d'un fichier de FIXTURE réel, jamais une donnée inventée).
 *
 * Étendu pour TODO_PRODUIT.md T5(a) ("lignes détaillées") — deux tests ajoutés, tous les tests
 * PRÉEXISTANTS restent inchangés (aucune assertion affaiblie) : un dépôt structuré porte désormais
 * SES LIGNES (désignation/quantité/prix unitaire HT/taux de TVA), extraites automatiquement du CII/
 * UBL qu'on savait déjà lire (`received-invoices/extraction.ts`), et un écart entre le total déposé
 * et la somme des lignes est un avertissement NOMMÉ, visible à l'écran et porté par le document,
 * jamais bloquant (`received-invoices/line-totals-check.ts`).
 *
 * Fixtures (`cypress/fixtures/received-invoices/`) — toutes générées par NOS PROPRES providers
 * (`cii-provider.ts`/`facturx-provider.ts`), jamais du XML écrit à la main :
 *  - `supplier-invoice-cii.xml` : CII EN 16931 réel et valide. Fournisseur "Fixture Fournisseur
 *    SARL", n° FIXTURE-INV-0001, date 2026-08-20, EUR, net 750.00 / TVA 150.00 / TTC 900.00, UNE
 *    ligne (3 x 250.00 @ 20%) qui somme EXACTEMENT à ces totaux — aucun avertissement attendu.
 *  - `supplier-invoice-facturx.pdf` : Factur-X réel (le même CII, embarqué dans un vrai PDF/A-3 via
 *    `@e-invoice-eu/core`) — le calque humain du PDF est une page blanche de substitution (le rendu
 *    Puppeteer réel n'a pas sa place dans un générateur de fixture), mais le XML embarqué, lui, est
 *    100% réel et a été vérifié offline (extraction.spec.ts) avant d'être committé ici.
 *  - `supplier-invoice-plain.pdf` : un PDF réel sans aucun XML embarqué — le cas de l'artisan qui
 *    scanne une facture papier — donc AUCUNE ligne extraite, jamais un motif d'échec.
 *  - `supplier-invoice-mismatch.xml` (T5(a)) : même méthode — CII réel via `ciiFormatProvider` (une
 *    ligne, 5 x 100.00 @ 20% = net 500.00 / TVA 100.00 / TTC 600.00) — puis SEUL le TTC de l'en-tête
 *    (`GrandTotalAmount`/`DuePayableAmount`) est corrigé chirurgicalement à 650.00 après coup : le
 *    cas réel, banal, d'un fournisseur dont le total imprimé ne s'accorde pas avec ses propres
 *    lignes. Jamais un XML écrit à la main — une édition numérique ciblée sur une sortie réelle.
 *
 * Les tests s'enchaînent dans CET ORDRE, sur un seul `resetAndSeed()` (pas un par test — même
 * convention que 17/33) : chaque fixture n'est donc uploadée pour de bon qu'UNE SEULE fois avant le
 * test dédié au doublon, qui la ré-uploade délibérément en dernier.
 *
 * Régression couverte par la même passe : 11 (la sidebar/dashboard ne casse pas avec un 5e type) et
 * 17 (le descripteur "received-invoice" rend ses champs et ses actions comme n'importe quel autre —
 * ce fichier n'a besoin d'AUCUNE modification pour ça, il boucle sur `GET /api/documents/types`).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const CII_FIXTURE = "cypress/fixtures/received-invoices/supplier-invoice-cii.xml";
const FACTURX_FIXTURE = "cypress/fixtures/received-invoices/supplier-invoice-facturx.pdf";
const PLAIN_PDF_FIXTURE = "cypress/fixtures/received-invoices/supplier-invoice-plain.pdf";
// TODO_PRODUIT.md T5(a) — real CII from `ciiFormatProvider` (one line: 5 x 100.00 @ 20% = net 500.00
// / VAT 100.00 / gross 600.00), with ONLY the HEADER's own GrandTotalAmount/DuePayableAmount
// surgically bumped to 650.00 afterwards — the exact, mundane real-world case this task's own warning
// exists to catch (the supplier's own printed total disagrees with what their own lines add up to).
// Never a hand-written fixture: see this file's own header and received-invoices/extraction.spec.ts.
const MISMATCH_FIXTURE = "cypress/fixtures/received-invoices/supplier-invoice-mismatch.xml";

interface ReceivedInvoiceInstance {
	id: string;
	status: string;
	data: Record<string, unknown>;
}

function listReceivedInvoices() {
	return cy
		.request<ReceivedInvoiceInstance[]>({ url: `${api}/api/documents?typeId=received-invoice` })
		.its("body");
}

function uploadAndOpenForm(fixturePath: string) {
	cy.get('[data-cy="received-invoice-upload-button"]').click();
	cy.get('[data-cy="received-invoice-upload-dialog"]', { timeout: 10000 }).should("be.visible");
	cy.get('[data-cy="received-invoice-upload-file-input"]').selectFile(fixturePath, { force: true });
	cy.get('[data-cy="received-invoice-upload-dialog"]').should("not.exist");
	// TODO_PRODUIT.md T5(a) — the dialog (the fixed-position overlay) is what must be visible; the
	// FORM inside it no longer fits above the fold now that it also carries a "lines" row (this is a
	// real, intentional consequence of the new field, not a bug) — `.should("be.visible")` on the
	// whole `<form>` checks its CENTER point, which a taller form can push below the dialog's own
	// scrollable viewport. `exist` is what every subsequent per-field assertion in this file actually
	// depends on; `document-create-dialog`'s own visibility is the genuine "did the dialog open" proof.
	cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");
	cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("exist");
}

function confirmReceive() {
	cy.get('[data-cy="document-action-receive"]').click();
	cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");
	cy.get('[data-cy="document-form"]').should("not.exist");
}

describe("Réception de factures — root TODO item 18", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
		cy.visit("/documents/received-invoice");
	});

	it("upload d'un Factur-X : les champs extraits pré-remplissent le formulaire, confirmer crée un document 'received', et l'original se télécharge à l'identique", () => {
		uploadAndOpenForm(FACTURX_FIXTURE);

		cy.get('[data-cy="document-field-supplier-input"]').should(
			"have.value",
			"Fixture Fournisseur SARL",
		);
		cy.get('[data-cy="document-field-supplierNumber-input"]').should("have.value", "FIXTURE-INV-0001");
		cy.get('[data-cy="document-field-netAmount-input"]').should("have.value", "750");
		cy.get('[data-cy="document-field-vatAmount-input"]').should("have.value", "150");
		cy.get('[data-cy="document-field-grossAmount-input"]').should("have.value", "900");
		// Le sélecteur de devise affiche EUR, et le sélecteur de date n'est plus sur son placeholder —
		// tous deux prouvent le pré-remplissage sans dépendre du format exact de leur rendu interne.
		cy.get('[data-cy="document-field-currency-input"]').should("contain.text", "EUR");
		cy.get('[data-cy="document-field-issueDate-input"]').should("not.contain.text", "Pick a date");

		// TODO_PRODUIT.md T5(a) — la ligne (BG-25) embarquée dans ce même CII est, elle aussi,
		// extraite et pré-remplie sans ressaisie ; sa somme (3 x 250.00 @ 20% = 900.00 TTC) s'accorde
		// EXACTEMENT avec les totaux déposés ci-dessus, donc AUCUN avertissement ne doit apparaître —
		// la régression que ce test couvre pour de vrai, sur un document réellement bien formé.
		cy.get('input[name="lines.0.description"]').should("have.value", "Prestation fixture");
		cy.get('input[name="lines.0.quantity"]').should("have.value", "3");
		cy.get('input[name="lines.0.unitPrice"]').should("have.value", "250");
		cy.get('input[name="lines.0.vatRate"]').should("have.value", "20");
		cy.get('[data-cy="document-line-total-warnings"]').should("not.exist");

		confirmReceive();

		// Retour à la liste, badge visible.
		cy.get('[data-cy="document-list-cards"]', { timeout: 10000 })
			.contains("Fixture Fournisseur SARL")
			.closest('[data-cy^="document-list-row-"]')
			.find('[data-cy="document-status-badge"]')
			.should("contain.text", "Received");

		listReceivedInvoices().then((instances) => {
			const created = instances.find((i) => i.data.supplier === "Fixture Fournisseur SARL");
			expect(created, "le document créé est bien retrouvé par l'API").to.exist;
			expect(created?.status).to.eq("received");
			expect(created?.data.fileRef, "un fileRef a été attaché").to.be.a("string");
			expect(
				created?.data.lineTotalWarnings,
				"pas d'écart, donc pas d'avertissement — même quand la ligne EST là",
			).to.deep.equal([]);

			// Le bouton de téléchargement existe à l'écran…
			cy.get(`[data-cy="document-custom-received-invoice-download-button-${created!.id}"]`, {
				timeout: 10000,
			}).should("be.visible");

			// … et l'API sert exactement les octets uploadés (assertion de contenu, jamais l'écran —
			// window.open() ouvre un onglet que Cypress n'observe pas).
			cy.readFile(FACTURX_FIXTURE, "binary").then((original) => {
				cy.request({
					url: `${api}/api/documents/received-invoices/${created!.id}/file`,
					encoding: "binary",
				}).then((res) => {
					expect(res.status).to.eq(200);
					expect(res.body).to.eq(original);
				});
			});
		});
	});

	it("upload d'un CII XML puis approbation par l'écran fait passer le document à 'approved'", () => {
		uploadAndOpenForm(CII_FIXTURE);
		confirmReceive();

		listReceivedInvoices().then((instances) => {
			// Le plus récent (tri par updatedAt desc — persistence.ts) est celui qu'on vient de créer.
			const created = instances[0];
			expect(created.data.supplier).to.eq("Fixture Fournisseur SARL");
			const id = created.id;

			cy.get(`[data-cy="document-row-action-approve-${id}"]`, { timeout: 10000 }).click();
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");

			cy.get(`[data-cy="document-list-row-${id}"]`)
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Approved");

			cy.request<ReceivedInvoiceInstance>({ url: `${api}/api/documents/${id}?typeId=received-invoice` })
				.its("body")
				.its("status")
				.should("eq", "approved");
		});
	});

	it("un PDF pur (sans XML embarqué) : formulaire vide mais le fichier est quand même attaché, jamais un refus", () => {
		uploadAndOpenForm(PLAIN_PDF_FIXTURE);

		cy.get('[data-cy="document-field-supplier-input"]').should("have.value", "");
		cy.get('[data-cy="document-field-supplierNumber-input"]').should("have.value", "");
		cy.get('[data-cy="document-field-netAmount-input"]').should("have.value", "");

		confirmReceive();

		listReceivedInvoices().then((instances) => {
			const created = instances[0]; // le plus récent
			expect(created.data.supplier, "aucun fournisseur extrait de ce PDF pur").to.be.oneOf([
				undefined,
				"",
			]);
			expect(created.status).to.eq("received");
			expect(created.data.fileRef, "le fichier est attaché malgré l'absence d'extraction").to.be.a(
				"string",
			);
			expect(
				created.data.lineTotalWarnings,
				"aucune ligne lisible : rien à contrôler, jamais un avertissement",
			).to.deep.equal([]);

			cy.readFile(PLAIN_PDF_FIXTURE, "binary").then((original) => {
				cy.request({
					url: `${api}/api/documents/received-invoices/${created.id}/file`,
					encoding: "binary",
				}).then((res) => {
					expect(res.status).to.eq(200);
					expect(res.body).to.eq(original);
				});
			});
		});
	});

	it("TODO_PRODUIT.md T5(a) — dépôt structuré avec lignes : les lignes s'affichent sans ressaisie, et un écart total/lignes affiche un avertissement nommé, jamais bloquant", () => {
		uploadAndOpenForm(MISMATCH_FIXTURE);

		// La ligne (désignation, quantité, prix unitaire HT, taux de TVA) est pré-remplie par
		// l'extraction — jamais retapée. Par NAME, pas par data-cy — même convention que la spec 20
		// (20-document-totals.cy.ts) : le data-cy d'un sous-champ de ligne est partagé entre lignes,
		// seul le `name` react-hook-form (`lines.0.xxx`) est unique.
		cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
		cy.get('input[name="lines.0.description"]').should("have.value", "Prestation désaccordée");
		cy.get('input[name="lines.0.quantity"]').should("have.value", "5");
		cy.get('input[name="lines.0.unitPrice"]').should("have.value", "100");
		cy.get('input[name="lines.0.vatRate"]').should("have.value", "20");

		// Le total TTC déposé (650) est repris TEL QUEL — jamais réécrit par la somme des lignes (600).
		cy.get('[data-cy="document-field-grossAmount-input"]').should("have.value", "650");

		// L'écart n'empêche jamais l'enregistrement — la facture reste enregistrable telle quelle.
		confirmReceive();

		listReceivedInvoices().then((instances) => {
			const created = instances.find(
				(i) => i.data.supplier === "Fixture Fournisseur Discordant SARL",
			);
			expect(created, "le document créé malgré l'écart est bien retrouvé par l'API").to.exist;
			expect(created?.status).to.eq("received");

			const warnings = created?.data.lineTotalWarnings as string[];
			expect(warnings, "un avertissement NOMMÉ est porté par le document").to.have.length(1);
			expect(warnings[0]).to.match(/Line total mismatch \(gross \/ TTC\)/);

			// … et il est VISIBLE À L'ÉCRAN en rouvrant le document depuis la liste (pas seulement au
			// moment de la création — le document le PORTE).
			cy.get(`[data-cy="document-list-row-${created!.id}"]`, { timeout: 10000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 10000 }).should("be.visible");
			// The dialog itself IS visible; the warning banner sits below the lines field, past the
			// fold of the dialog's own scrollable content — scrollIntoView() is what genuinely proves
			// "visible on screen" for an element a real reviewer would just scroll down to see, rather
			// than a `.should('exist')` that would also pass for something CSS actually hid.
			cy.get('[data-cy="document-line-total-warnings"]', { timeout: 10000 })
				.scrollIntoView()
				.should("be.visible")
				.and("contain.text", "gross / TTC");
		});
	});

	it("TODO_PRODUIT.md T5(a) — éditer une ligne fait réagir le contrôle de somme (le nombre d'avertissements change)", () => {
		listReceivedInvoices().then((instances) => {
			const target = instances.find((i) => i.data.supplier === "Fixture Fournisseur Discordant SARL");
			expect(target, "le document créé par le test précédent existe toujours").to.exist;

			cy.get(`[data-cy="document-list-row-${target!.id}"]`, { timeout: 10000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 10000 }).should("be.visible");

			// Avant édition : un seul avertissement (gross/TTC — voir le test précédent).
			cy.get('[data-cy="document-line-total-warnings"] p').should("have.length", 1);

			// On double la quantité (5 -> 10) : la ligne passe à net 1000 / TVA 200 / TTC 1200, qui ne
			// s'accorde plus avec AUCUN des trois totaux déposés (500 / 100 / 650) — les trois
			// avertissements doivent apparaître, la preuve que le contrôle RÉAGIT à l'édition d'une ligne.
			cy.get('input[name="lines.0.quantity"]').clear({ force: true }).type("10", { force: true });
			cy.get('[data-cy="document-action-receive"]').click();
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");

			// Le dialogue d'édition (contrairement à celui de dépôt) reste OUVERT après un "receive"
			// réussi sur un enregistrement déjà existant ([typeId].tsx — "same-type success needs
			// nothing here at all") : le bandeau, à l'ÉCRAN, doit donc déjà montrer les TROIS
			// avertissements sans même rouvrir le document.
			cy.get('[data-cy="document-line-total-warnings"] p', { timeout: 10000 }).should("have.length", 3);

			cy.request<ReceivedInvoiceInstance>({
				url: `${api}/api/documents/${target!.id}?typeId=received-invoice`,
			})
				.its("body")
				.then((updated) => {
					const warnings = updated.data.lineTotalWarnings as string[];
					expect(warnings, "l'édition de la ligne a fait réagir le contrôle").to.have.length(3);
					expect(warnings.some((w) => w.includes("net / HT"))).to.eq(true);
					expect(warnings.some((w) => w.includes("VAT"))).to.eq(true);
					expect(warnings.some((w) => w.includes("gross / TTC"))).to.eq(true);
				});
		});
	});

	it("un même fichier re-uploadé (même hash — le CII XML déjà reçu ci-dessus) est refusé, nommé, comme doublon", () => {
		cy.get('[data-cy="received-invoice-upload-button"]').click();
		cy.get('[data-cy="received-invoice-upload-file-input"]').selectFile(CII_FIXTURE, { force: true });
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "duplicate");
		// Refusé au stade de l'upload : aucun formulaire de création n'apparaît.
		cy.get('[data-cy="document-form"]').should("not.exist");
	});

	it("régression 17 : 'received-invoice' apparaît dans la liste des types enregistrés", () => {
		cy.request<{ id: string; label: string }[]>({ url: `${api}/api/documents/types` })
			.its("body")
			.then((types) => {
				expect(types.map((t) => t.id)).to.include("received-invoice");
			});
	});

	it("régression 11 : le tableau de bord affiche toujours au moins une contribution, aucune non rendue", () => {
		cy.visit("/dashboard");
		cy.get('[data-cy^="widget-"]', { timeout: 20000 }).should("exist");
		cy.get('[data-cy="widget-unsupported"]').should("not.exist");
	});
});
