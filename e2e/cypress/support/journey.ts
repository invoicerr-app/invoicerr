/**
 * Le parcours de facturation, joué à l'écran — et paramétré par le PAYS.
 *
 * Ces aides vivaient dans `19-correction-flow.cy.ts`, où elles nommaient la France en dur. Les
 * sortir ici n'est pas du rangement : c'est la seule façon de rejouer EXACTEMENT le même corps de
 * test dans un autre pays. Si le parcours devait être réécrit pour les États-Unis, c'est que
 * quelque chose, quelque part, nommerait un pays — ce que ce dépôt s'interdit.
 *
 * La règle reste celle des specs qui les utilisent : les ACTIONS passent par l'interface, les
 * ASSERTIONS lisent l'enregistrement.
 */
import { api, setupCountry, waitForSettled } from "./showcase";

/** Ce qu'il faut savoir d'un pays pour jouer le parcours. Rien de plus : pas de règle, des données. */
export interface JourneyCountry {
	/** Nom de la société créée — distinct par spec, sinon les jeux se marchent dessus. */
	label: string;
	/** Nom du pays tel que l'API l'attend ("France", "United States"). */
	name: string;
	iso: string;
	identifiers: { scheme: string; value: string }[];
	/** Suffixe `data-cy` de l'option client — `SearchSelect` le dérive du libellé. */
	clientSlug: string;
	/** Le taux saisi dans le formulaire. Une donnée du jeu d'essai, pas une règle fiscale. */
	vatRate: number;
}

export type InvoiceRow = {
	id: string;
	status: string;
	kind: string | null;
	number: number | null;
	rawNumber: string | null;
	correctsInvoiceId: string | null;
	totalTTC: number;
	items: { id: string; name: string }[];
};

export const getInvoice = (id: string) =>
	cy.request<InvoiceRow>({ url: `${api}/api/invoices/${id}` }).its("body");

/**
 * The correction the UI just produced for `originalId`, whatever id it chose.
 *
 * Retried, for the same reason `eventually` exists: a click returns before the record is written, and
 * a single read turns "not yet" into "never happened". The earlier version also passed `?limit=100`,
 * which the endpoint ignores — its page size is fixed at 10 — so the parameter read as a safety net
 * while providing none.
 */
export const draftCorrectionOf = (originalId: string, tries = 10) => {
	const attempt = (left: number): Cypress.Chainable<InvoiceRow> =>
		cy
			.request({ url: `${api}/api/invoices` })
			.its("body")
			.then((body: unknown) => {
				const rows = (
					Array.isArray(body)
						? body
						: ((body as { invoices?: InvoiceRow[] }).invoices ?? [])
				) as InvoiceRow[];
				const found = rows.find((r) => r.correctsInvoiceId === originalId);
				if (found) return cy.wrap(found);
				if (left <= 1) {
					expect(
						rows.map((r) => `${r.kind}:${r.status}`).join(" | ") || "(no rows)",
						`the UI produced a correction of ${originalId} — the page holds`,
					).to.eq(`a correction of ${originalId}`);
				}
				return cy.wait(700).then(() => attempt(left - 1));
			});
	return attempt(tries);
};

/**
 * The draft the CREATION FORM just produced, in this test's own freshly-made company.
 *
 * Same race as `draftCorrectionOf`, one step earlier: the dialog closes the tick `useDocumentUpsert`
 * gets its 2xx back, but the list it closes onto is a separate refetch. Filtering on
 * `status === "DRAFT" && number === null` rather than just "the only row" keeps this correct even if
 * a later change makes the fixture share a company across calls.
 */
export const draftJustCreated = (tries = 10) => {
	const attempt = (left: number): Cypress.Chainable<InvoiceRow> =>
		cy
			.request({ url: `${api}/api/invoices` })
			.its("body")
			.then((body: unknown) => {
				const rows = (
					Array.isArray(body)
						? body
						: ((body as { invoices?: InvoiceRow[] }).invoices ?? [])
				) as InvoiceRow[];
				const found = rows.find(
					(r) => r.status === "DRAFT" && r.number === null,
				);
				if (found) return cy.wrap(found);
				if (left <= 1) {
					expect(
						rows.map((r) => `${r.kind}:${r.status}`).join(" | ") || "(no rows)",
						"the creation form produced a draft — the page holds",
					).to.eq("a fresh draft");
				}
				return cy.wait(700).then(() => attempt(left - 1));
			});
	return attempt(tries);
};

/**
 * Click a control on the row of a SPECIFIC invoice — never `.first()`, which drifts.
 *
 * Both queries carry the timeout, not just the outer one: a `{timeout}` on `cy.get` only governs
 * that command's own wait for the ROW to exist, not the `.find()` chained after it. Every previous
 * caller happened to follow a fresh `cy.visit`, where the row already had its final button set on
 * first paint — so the default 4s on `.find()` never mattered until a fixture stayed on the SAME
 * page across an in-place refetch (issue, then send, without navigating between them) and hit it.
 */
export const onRow = (invoiceId: string, dataCy: string) =>
	cy
		.get(`[data-cy="invoice-row"][data-invoice-id="${invoiceId}"]`, {
			timeout: 20000,
		})
		.find(`[data-cy="${dataCy}"]`, { timeout: 20000 })
		.click();

/**
 * Read the record back until it says what we expect, or fail saying what it actually said.
 *
 * A single read after a 200 is a race: the response returns before the list has refetched and, more
 * to the point, a failure then tells you the value but never how long it stayed wrong. This retries
 * and reports the last thing it saw.
 */
export const eventually = (
	id: string,
	predicate: (row: InvoiceRow) => boolean,
	what: string,
	tries = 10,
) => {
	const attempt = (left: number): Cypress.Chainable<InvoiceRow> =>
		cy.request<InvoiceRow>({ url: `${api}/api/invoices/${id}` }).then((res) => {
			if (predicate(res.body)) return cy.wrap(res.body);
			if (left <= 1) {
				expect(
					JSON.stringify({ status: res.body.status, number: res.body.number }),
					what,
				).to.eq(what);
			}
			return cy.wait(700).then(() => attempt(left - 1));
		});
	return attempt(tries);
};

/**
 * Confirm a send actually landed the document where correction is offered from —
 * DELIVERED / ACCEPTED / REPORTED, per the lifecycle comment `send()` used to carry — rather than
 * trusting that clicking the confirmation button produced a 2xx somewhere. A UI-driven send has no
 * HTTP response for the test to inspect the way the old `cy.request`-based helper did; reading the
 * backend-derived action back is the equivalent check on the record, not a weaker one — it fails
 * exactly when the fixture would have been half-worked (queued, then rejected).
 */
export const eventuallyCorrectable = (id: string, tries = 15) => {
	const attempt = (left: number): Cypress.Chainable<unknown> =>
		cy
			.request<{
				complianceStatus: string | null;
				actions: Record<string, boolean>;
			}>({
				url: `${api}/api/invoices/${id}/available-actions`,
			})
			.its("body")
			.then((body) => {
				if (body.actions?.correct) return cy.wrap(body);
				if (left <= 1) {
					expect(
						`complianceStatus=${body.complianceStatus} actions=${JSON.stringify(body.actions)}`,
						"the send settled somewhere correction is offered from",
					).to.eq("the send settled somewhere correction is offered from");
				}
				return cy.wait(700).then(() => attempt(left - 1));
			});
	return attempt(tries);
};

/**
 * Fill in and submit the invoice CREATION form: the client, one line, submit.
 *
 * Assumes the create dialog is already open. `clientSlug` is the option's `data-cy` suffix
 * (`SearchSelect` slugs it from the option's label), so this only works for a client whose name is
 * known up front — exactly what `setupCountry` hands back.
 */
export const fillAndSubmitInvoiceForm = (
	clientSlug: string,
	unitPrice: number,
	vatRate: number,
) => {
	cy.get('[data-cy="invoice-dialog"]', { timeout: 15000 }).should("be.visible");
	cy.get('[data-cy="invoice-client-select"]').find("button").click();
	cy.get(`[data-cy="invoice-client-select-option-${clientSlug}"]`, {
		timeout: 10000,
	}).click();
	cy.contains("button", /Add Item/i, { timeout: 15000 }).click();
	cy.get('[name="items.0.name"]').type("Consulting", { force: true });
	cy.get('[name="items.0.quantity"]')
		.clear({ force: true })
		.type("1", { force: true });
	cy.get('[name="items.0.unitPrice"]')
		.clear({ force: true })
		.type(String(unitPrice), { force: true });
	cy.get('[name="items.0.vatRate"]')
		.clear({ force: true })
		.type(String(vatRate), { force: true });
	cy.get('[data-cy="invoice-submit"]').click();
	cy.get('[data-cy="invoice-dialog"]', { timeout: 15000 }).should("not.exist");
};

/**
 * Une facture émise ET envoyée, construite entièrement depuis l'écran, dans le pays donné.
 *
 * Seules la société et le client restent en API : ils sont déjà couverts par les specs 02 et 05, et
 * les piloter par des formulaires rendrait ambigu chaque échec du parcours lui-même.
 */
export const issuedSentInvoice = (c: JourneyCountry, unitPrice = 1000) =>
	setupCountry(c.label, c.name, c.iso, c.identifiers).then(() => {
		// Créer : le bouton d'ajout, le formulaire, le client, une ligne, la soumission.
		cy.visit("/invoices");
		cy.get('[data-cy="invoice-add-button"]', { timeout: 20000 }).click();
		fillAndSubmitInvoiceForm(c.clientSlug, unitPrice, c.vatRate);

		return draftJustCreated().then((draft) => {
			// Émettre : un clic SÉPARÉ, sur la ligne où le brouillon vient d'atterrir.
			onRow(draft.id, "invoice-issue-button");

			return eventually(
				draft.id,
				(r) => r.status === "ISSUED" && r.number !== null,
				"la facture du jeu d'essai a atteint ISSUED, par son propre bouton",
			).then(() => {
				// Envoyer : le bouton de la ligne, PUIS sa confirmation. Sauter la confirmation n'est
				// pas un raccourci vers le même résultat : c'est une autre action, qui n'envoie rien.
				onRow(draft.id, "invoice-send-button");
				cy.get('[data-cy="send-confirmation-confirm"]', {
					timeout: 15000,
				}).click();

				waitForSettled(draft.id);
				return eventuallyCorrectable(draft.id).then(() => cy.wrap(draft.id));
			});
		});
	});

/**
 * Une facture ÉMISE, pas envoyée — construite depuis l'écran, dans le pays donné.
 *
 * L'immuabilité s'applique dès l'émission : elle est donc observable dans les pays dont le canal
 * n'a pas d'identifiants ici (Italie, Mexique), là où `issuedSentInvoice` ne peut pas aboutir.
 */
export const issuedInvoiceOnly = (c: JourneyCountry, unitPrice = 1000) =>
	setupCountry(c.label, c.name, c.iso, c.identifiers).then(() => {
		cy.visit("/invoices");
		cy.get('[data-cy="invoice-add-button"]', { timeout: 20000 }).click();
		fillAndSubmitInvoiceForm(c.clientSlug, unitPrice, c.vatRate);

		return draftJustCreated().then((draft) => {
			onRow(draft.id, "invoice-issue-button");
			return eventually(
				draft.id,
				(r) => r.status === "ISSUED" && r.number !== null,
				"la facture a atteint ISSUED, par son propre bouton",
			).then(() => cy.wrap(draft.id));
		});
	});

// ─────────────── Le trajet devis → facture → paiement, réutilisable par pays ───────────────
//
// Ces aides vivaient dans les specs 23 et 25, où elles nommaient la France en dur. Les sortir ici
// permet de rejouer le MÊME trajet en Italie et au Mexique — les deux pays dont seule la jambe
// CORRECTION dépend d'un canal sans identifiants. Le reste du parcours, lui, n'en dépend pas, et
// je l'avais laissé sans preuve.

export const otpFromMail = () =>
	cy.getLastEmail().then((email: { Text?: string; HTML?: string }) => {
		const text = email.Text || email.HTML || "";
		const otp = (text.match(/\d{4}-?\d{4}/) || [])[0]?.replace("-", "") ?? "";
		expect(otp, "un code à 8 chiffres dans le courrier").to.have.length(8);
		return cy.wrap(otp);
	});

/** Faire signer le devis comme le client le ferait : le lien, puis le code, puis le bouton. */
export const signThroughTheScreen = (quoteId: string) => {
	cy.clearEmails();
	cy.visit("/quotes");
	cy.get(`[data-cy="send-signature-${quoteId}"]`, { timeout: 20000 }).click();
	// L'envoi passe par une confirmation, qui montre à qui le devis part. Sauter cette étape était
	// mon erreur : le clic n'avait produit AUCUNE requête, et j'ai d'abord cru le bouton mort.
	cy.get('[data-cy="send-confirmation-confirm"]', { timeout: 15000 }).click();

	// Le lien de signature arrive au client. On le suit comme lui plutôt que de fabriquer
	// l'identifiant : un lien cassé dans le courrier est un défaut que seul ce chemin voit.
	return cy.getLastEmail().then((email: { Text?: string; HTML?: string }) => {
		const body = email.Text || email.HTML || "";
		const sigId = (body.match(/signature\/([0-9a-f-]{36})/) || [])[1];
		expect(
			sigId,
			`un lien de signature dans le courrier — reçu : ${body.slice(0, 200)}`,
		).to.match(/^[0-9a-f-]{36}$/);

		cy.clearEmails();
		cy.visit(`/signature/${sigId}`);
		cy.get('[data-cy="send-otp-btn"]', { timeout: 20000 }).click();

		return otpFromMail().then((otp) => {
			cy.get("input[data-input-otp]", { timeout: 15000 }).type(
				otp as unknown as string,
				{
					force: true,
				},
			);
			cy.get('[data-cy="sign-quote-btn"]').click();
			return cy.wrap(quoteId);
		});
	});
};

/**
 * Attendre que le devis soit signé, en relisant l'enregistrement.
 *
 * `/api/quotes/table` rend le TABLEAU directement — pas un objet qui le contient — et la signature
 * atterrit de façon asynchrone. Une lecture unique rendait un tableau là où j'attendais un statut.
 */
export const expectQuoteSigned = (quoteId: string, attempts = 8) => {
	cy.request<{ id: string; status: string }[]>({
		url: `${api}/api/quotes/table`,
	})
		.its("body")
		.then((quotes) => {
			const q = quotes.find((x) => x.id === quoteId);
			if ((!q || q.status !== "SIGNED") && attempts > 0) {
				cy.wait(800);
				return expectQuoteSigned(quoteId, attempts - 1);
			}
			expect(q, `le devis ${quoteId} figure dans la liste`).to.exist;
			expect(q?.status, "le devis est signé").to.eq("SIGNED");
		});
};

/**
 * La facture que la conversion vient de produire pour `quoteId`, quel que soit son id.
 *
 * `cy.click()` revient dès que l'événement DOM est traité — pas quand la promesse de
 * `triggerCreateInvoice` a fini son aller-retour HTTP (`create-invoice-from-quote-dialog.tsx` ne
 * ferme le dialogue et ne navigue vers le PDF que dans le `.then()` de cette promesse). Une lecture
 * immédiate de la liste peut donc arriver avant que `POST /invoices/create-from-quote` ait fini
 * d'écrire — l'endpoint est pourtant synchrone (create + brouillon compliance + webhook, tous
 * attendus côté service), la course est côté test, pas côté backend.
 *
 * Vérifié séparément : la taille de page fixée à 10 sur `GET /api/invoices` (R-P3-10, `?limit=`
 * ignoré) N'EST PAS en cause ici — chaque test de ce fichier tourne dans une société fraîchement
 * créée par `setupCountry`, et la requête est filtrée par `companyId` côté service ; il n'y a jamais
 * plus d'une poignée de factures à lire. La vraie cause est uniquement la course ci-dessus, donc le
 * correctif est une LECTURE QUI RÉESSAIE — même famille que `eventually`/`draftCorrectionOf` dans la
 * spec 19 — et non un assouplissement de l'assertion finale.
 */
export const invoiceFromQuote = (quoteId: string, tries = 10) => {
	const attempt = (
		left: number,
	): Cypress.Chainable<{ quoteId?: string; status?: string } | undefined> =>
		cy
			.request({ url: `${api}/api/invoices` })
			.its("body")
			.then((body: unknown) => {
				const rows = (
					Array.isArray(body)
						? body
						: ((body as { invoices?: { quoteId?: string; status?: string }[] })
								.invoices ?? [])
				) as { quoteId?: string; status?: string }[];
				const found = rows.find((r) => r.quoteId === quoteId);
				if (found) return cy.wrap(found);
				if (left <= 1) {
					expect(
						rows.map((r) => `${r.quoteId ?? "?"}:${r.status}`).join(" | ") ||
							"(aucune ligne)",
						`une facture issue du devis ${quoteId} — la liste contient`,
					).to.eq(`une facture issue du devis ${quoteId}`);
				}
				return cy.wait(500).then(() => attempt(left - 1));
			});
	return attempt(tries);
};

/** Enregistrer un paiement DEPUIS L'ÉCRAN, sur la facture désignée par son numéro. */
export const payThroughTheScreen = (rawNumber: string, amount: number) => {
	cy.visit("/payments");
	cy.contains("button", /add|new|créer|ajouter/i, { timeout: 20000 }).click();
	cy.get('[data-cy="payment-dialog"]', { timeout: 15000 }).should("be.visible");

	// Choisie par son NUMÉRO, jamais `.first()` : la liste contient les factures des tests
	// précédents, et payer celle du voisin passerait pour un succès.
	cy.get('[data-cy="payment-invoice-select"] button').first().click();
	cy.get('[data-cy="payment-invoice-select-options"]', {
		timeout: 10000,
	}).should("be.visible");
	cy.get('[data-cy="payment-invoice-select-options"]')
		.contains("button", rawNumber)
		.click();

	cy.get('[data-cy="payment-amount-input"]')
		.clear({ force: true })
		.type(String(amount), { force: true });
	cy.get('[data-cy="payment-submit"]').click();
	cy.get('[data-cy="payment-dialog"]', { timeout: 15000 }).should("not.exist");
};
