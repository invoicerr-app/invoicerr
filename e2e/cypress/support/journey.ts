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
