export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Custom fields — proven THROUGH THE SCREEN like the rest of this
 * suite: ACTIONS go through the interface (Settings -> Custom fields to define, the expense/client
 * forms to fill), content ASSERTIONS go through the API. Backend module:
 * `backend/src/modules/documents/company-custom-fields/`.
 *
 * "expense" is the DOCUMENT type used throughout (never quote/invoice): it needs no client, no line
 * items, no country-policy gate — the smallest surface that still exercises a real, generic
 * DocumentFieldDescriptor form/list/save-draft round trip (see 62-expense-attachments.cy.ts, the same
 * choice for the same reason).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

interface CustomFieldDefinition {
	id: string;
	target: "CLIENT" | "DOCUMENT";
	documentTypeId: string | null;
	key: string;
	label: string;
	kind: string;
	required: boolean;
	archivedAt: string | null;
}

interface ExpenseInstance {
	id: string;
	status: string;
	data: Record<string, unknown>;
}

function listDefinitions() {
	return cy
		.request<CustomFieldDefinition[]>({ url: `${api}/api/custom-fields?includeArchived=true` })
		.its("body");
}

function listExpenses() {
	// GET /api/documents is now a paged `{ items, total, page, pageSize }` — never a bare
	// array (documents.controller.ts's own "List document instances"). `.its("body.items")` loses
	// the element type through Cypress's own dotted-path typing, so this unwraps via `.then` instead
	// to keep every `.find`/`.filter` callback below typed.
	return cy
		.request<{ items: ExpenseInstance[] }>({ url: `${api}/api/documents?typeId=expense` })
		.its("body")
		.then((body) => body.items);
}

function openExpenseCreateDialog() {
	cy.visit("/documents/expense");
	cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
	// The DIALOG itself (document-create-dialog.tsx's `max-h-[90vh]` panel) is size-constrained
	// and centered, so checking ITS visibility is reliable. The <form> it wraps is not: this spec's own
	// first test permanently adds two custom fields to "expense" (Cost Center + Internal Notes), and the
	// native descriptor already has several fields of its own (expense.descriptor.ts) — tall enough,
	// once both are on screen, that `<form>` no longer fits inside the dialog's own max-height. Cypress's
	// `be.visible` on an element genuinely taller than its scrollable ancestor's client height fails
	// (however it's scrolled — some portion is always clipped, see "How about scrolling to the element
	// with cy.scrollIntoView()?"), so `exist` — reached by every caller of this helper regardless of
	// how tall the form has grown — is what actually proves the dialog opened.
	cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");
	cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("exist");
}

function pickSelectOption(fieldKey: string, optionSlug: string) {
	cy.get(`[data-cy="document-field-${fieldKey}-input"] button`).first().click({ force: true });
	cy.get(`[data-cy="document-field-${fieldKey}-input-options"]`, { timeout: 10000 }).should("be.visible");
	cy.get(`[data-cy^="document-field-${fieldKey}-input-option-${optionSlug}"]`).first().click();
}

/** Archive/restore live in the row's "..." menu (`settings-section.tsx`'s `SettingsRowMenu` grammar,
 *  shared by every settings list in the app) rather than as a directly-clickable button, so reaching
 *  either action means opening that menu first. */
function clickRowMenuItem(menuDataCy: string, itemDataCy: string) {
	cy.get(`[data-cy="${menuDataCy}"]`, { timeout: 15000 }).scrollIntoView().click();
	cy.get(`[data-cy="${itemDataCy}"]`, { timeout: 10000 }).should("be.visible").click();
}

function fillMinimalExpenseNativeFields(description: string) {
	cy.get('[data-cy="document-field-description-input"]').type(description);
	cy.get('[data-cy="document-field-amount-input"]').type("10");
	pickSelectOption("currency", "eur");
	cy.pickToday('[data-cy="document-field-date-input"]');
}

/** Opens Settings -> Custom fields and creates ONE definition through the real screen — the only
 *  entry point exercised by this whole spec for writing a definition. */
function createDefinitionThroughScreen(input: {
	target: "DOCUMENT" | "CLIENT";
	documentTypeId?: string;
	label: string;
	kind: string;
	required?: boolean;
	options?: { value: string; label: string }[];
}) {
	cy.visit("/settings/customFields");
	cy.get('[data-cy="custom-fields-settings"]', { timeout: 15000 }).should("be.visible");

	cy.get('[data-cy="custom-field-target-input"]').click();
	cy.get(`[data-cy="custom-field-target-option-${input.target.toLowerCase()}"]`).click();

	if (input.target === "DOCUMENT" && input.documentTypeId) {
		cy.get('[data-cy="custom-field-document-type-input"]').click();
		cy.get(`[data-cy="custom-field-document-type-option-${input.documentTypeId}"]`).click();
	}

	cy.get('[data-cy="custom-field-label-input"]').clear().type(input.label);

	cy.get('[data-cy="custom-field-kind-input"]').click();
	cy.get(`[data-cy="custom-field-kind-option-${input.kind}"]`).click();

	if (input.kind === "select") {
		for (const option of input.options ?? []) {
			cy.get('[data-cy="custom-field-option-add"]').click();
		}
		(input.options ?? []).forEach((option, index) => {
			cy.get(`[data-cy="custom-field-option-value-${index}"]`).type(option.value);
			cy.get(`[data-cy="custom-field-option-label-${index}"]`).type(option.label);
		});
	}

	if (input.required) {
		cy.get('[data-cy="custom-field-required-input"]').click();
	}

	cy.get('[data-cy="custom-field-create-submit"]').click();
	cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");
}

describe("Custom fields — settings-defined, appear on the form/list/PDF", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("Settings -> Custom fields creates a REQUIRED text field for expenses, an optional long-text one, and a CLIENT select field", () => {
		createDefinitionThroughScreen({
			target: "DOCUMENT",
			documentTypeId: "expense",
			label: "Cost Center",
			kind: "text",
			required: true,
		});
		createDefinitionThroughScreen({
			target: "DOCUMENT",
			documentTypeId: "expense",
			label: "Internal Notes",
			kind: "longText",
		});
		createDefinitionThroughScreen({
			target: "CLIENT",
			label: "Loyalty Tier",
			kind: "select",
			options: [
				{ value: "gold", label: "Gold" },
				{ value: "silver", label: "Silver" },
			],
		});

		listDefinitions().then((definitions) => {
			expect(definitions, "les trois définitions existent bien côté API").to.have.length(3);
			const costCenter = definitions.find((d) => d.label === "Cost Center");
			expect(costCenter?.key, "la clé est dérivée du libellé").to.eq("cost_center");
			expect(costCenter?.kind).to.eq("text");
			expect(costCenter?.required).to.eq(true);
			expect(costCenter?.documentTypeId).to.eq("expense");

			const loyalty = definitions.find((d) => d.label === "Loyalty Tier");
			expect(loyalty?.target).to.eq("CLIENT");
			expect(loyalty?.kind).to.eq("select");
		});
	});

	it("a REQUIRED custom field left empty blocks the wizard's own 'Continue', exactly like a native required field", () => {
		openExpenseCreateDialog();
		fillMinimalExpenseNativeFields("Missing cost center");
		// "Cost Center" (required text, merged onto the SAME "Details" step as the native required
		// fields — it is `required`, same criterion as document-create-dialog.tsx's `buildFieldGroups`)
		// is left empty on purpose. "Continue" runs `form.trigger` on the step's OWN fields
		// (stepped-dialog.tsx) — no API call happens at all, so this blocks locally, with no toast.
		cy.get('[data-cy="document-create-dialog-continue"]').click();

		// Still on "Details" — the wizard never advances a step it can't validate.
		cy.get('[data-cy="document-create-dialog-step-body-details"]', { timeout: 10000 }).should("exist");
		cy.get('[data-cy="document-field-custom:cost_center-input"]').should("exist");
	});

	it("filling both custom fields through the screen saves, and the API shows them under their PREFIXED keys", () => {
		openExpenseCreateDialog();
		fillMinimalExpenseNativeFields("Client dinner with cost center");
		// "Cost Center" is REQUIRED, so it merges onto the SAME "Details" step as the native
		// required fields (document-create-dialog.tsx's `buildFieldGroups`) — fill it before
		// "Continue"; "Internal Notes" is optional, on "Options", one step later.
		cy.get('[data-cy="document-field-custom:cost_center-input"]').type("CC-42");
		cy.continueDocumentWizard(); // Details -> Options
		cy.get('[data-cy="document-field-custom:internal_notes-input"]').type(
			"A distinctly long internal note that should add real, measurable bytes to the rendered PDF.",
		);
		cy.continueDocumentWizard(); // Options -> Summary

		// A successful first save lands on the new record's own page (document-create-dialog.tsx) —
		// nothing about that screen is asserted here: content assertions belong to the API below.
		cy.get('[data-cy="document-action-save-draft"]').click();
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");

		listExpenses().then((expenses) => {
			const created = expenses.find((e) => e.data.description === "Client dinner with cost center");
			expect(created, "la dépense créée est bien retrouvée par l'API").to.exist;
			expect(created?.data["custom:cost_center"]).to.eq("CC-42");
			expect(created?.data["custom:internal_notes"]).to.contain("distinctly long internal note");
		});
	});

	it("the custom field value appears on the document LIST card, generically, without a page-specific column", () => {
		listExpenses().then((expenses) => {
			const created = expenses.find((e) => e.data.description === "Client dinner with cost center");
			cy.visit("/documents/expense");
			cy.get(`[data-cy="document-list-row-${created!.id}"]`, { timeout: 15000 }).should(
				"contain.text",
				"Cost Center: CC-42",
			);
		});
	});

	// Backend: `documents.service.ts#runAction` — a company custom field is validated in the SAME pass
	// as every native field (`validateAgainstDescriptor` over the merged view
	// `company-custom-fields/persistence.ts#applyCompanyCustomFieldsView` composes onto the country
	// view), so a missing REQUIRED one now surfaces with the exact same "Invalid document data" shape
	// (and a per-field `errors[].key`) a native field's own violation already gets — never a
	// custom-fields-specific message a client would have to special-case.
	it("a scripted save-draft omitting the REQUIRED custom field is refused by the SERVER too (400), even bypassing the screen — same error shape as a native field", () => {
		cy.request({
			method: "POST",
			url: `${api}/api/documents/types/expense/actions/save-draft`,
			body: { data: { description: "Bypassing the screen entirely", amount: 5, currency: "EUR" } },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "refusé par le serveur, pas seulement par le formulaire").to.eq(400);
			expect(res.body.message).to.eq("Invalid document data");
			expect(res.body.errors).to.deep.include.members([
				{ key: "custom:cost_center", message: '"Cost Center" is required.' },
			]);
		});
	});

	// "expense" (the type used throughout this spec) has no "send" action at all — see
	// expense.descriptor.ts (only "save-draft"/"delete"). The proof that a required custom field also
	// blocks "send", not merely "save-draft", is a backend concern instead:
	// documents.service.company-custom-fields.spec.ts, against the "quote" type, through the real
	// `runAction` gate.

	it("the PDF grows once the optional long-text custom field carries real content — the end-of-document block", () => {
		function saveExpenseAndGetPdfSize(description: string, notes: string | undefined) {
			openExpenseCreateDialog();
			fillMinimalExpenseNativeFields(description);
			// "Cost Center" (required) is on "Details"; "Internal Notes" (optional) is one step
			// later, on "Options" — see the earlier test's own comment.
			cy.get('[data-cy="document-field-custom:cost_center-input"]').type("CC-PDF");
			cy.continueDocumentWizard(); // Details -> Options
			if (notes) {
				cy.get('[data-cy="document-field-custom:internal_notes-input"]').type(notes);
			}
			cy.continueDocumentWizard(); // Options -> Summary
			// A successful first save lands on the new record's own page — see the earlier test above;
			// the size comparison below reads the API, never that screen.
			cy.get('[data-cy="document-action-save-draft"]').click();
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");

			return listExpenses().then((expenses) => {
				const created = expenses.find((e) => e.data.description === description);
				expect(created, "la dépense de comparaison PDF existe").to.exist;
				return cy
					.request({ url: `${api}/api/documents/${created!.id}/pdf?typeId=expense`, encoding: "binary" })
					.then((res) => {
						expect(res.status).to.eq(200);
						expect(res.headers["content-type"]).to.include("application/pdf");
						return res.body.length as number;
					});
			});
		}

		saveExpenseAndGetPdfSize("PDF baseline without notes", undefined).then((baselineSize) => {
			saveExpenseAndGetPdfSize(
				"PDF with a long internal note",
				"This internal note is deliberately long and distinctive so its extra bytes on the additional-fields block cannot be explained by anything else on the page.",
			).then((withNotesSize) => {
				cy.log(`baseline=${baselineSize}o with-notes=${withNotesSize}o`);
				expect(
					withNotesSize,
					"le bloc « champs supplémentaires » ajoute des octets réels en fin de document",
				).to.be.greaterThan(baselineSize + 50);
			});
		});
	});

	it("a client fills its own custom SELECT field through the client form, stored unprefixed in customFields", () => {
		cy.visit("/clients");
		cy.contains("button", /add|new|créer|ajouter/i, { timeout: 10000 }).click();
		cy.get('[data-cy="client-dialog"]', { timeout: 5000 }).should("be.visible");

		cy.get('[name="name"]').clear().type("Custom Fields Client SARL");
		cy.continueSteppedDialog("client-dialog");

		cy.selectCountry("client-country-select", "France");
		cy.get('[name="address"]').clear().type("1 Rue des Champs Personnalisés");
		cy.get('[name="postalCode"]').clear().type("75000");
		cy.get('[name="city"]').clear().type("Paris");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-identifier-LEGAL_ID"]', { timeout: 10000 }).clear().type("123456789");
		cy.get('[data-cy="client-currency-select"] button').scrollIntoView().click();
		cy.get('[data-cy="client-currency-select-options"]').should("be.visible");
		cy.get('[data-cy="client-currency-select"] input').type("Euro");
		cy.get('[data-cy="client-currency-select-option-euro-(€)"]').click();
		cy.continueSteppedDialog("client-dialog");

		// Custom CLIENT-target fields now live at the end of the Contact & portal step.
		cy.get('[name="contactEmail"]').clear().type("cf-client@example.com");
		cy.get('[data-cy="client-custom-fields-section"]').scrollIntoView().should("be.visible");
		pickSelectOption("loyalty_tier", "gold");
		cy.continueSteppedDialog("client-dialog");

		cy.get('[data-cy="client-submit"]').click();
		cy.get('[data-cy="client-dialog"]').should("not.exist");
		cy.contains("Custom Fields Client SARL", { timeout: 10000 });

		// `GET /api/clients` returns `{ pageCount, clients }` (clients.service.ts#getClients), never a
		// bare array — same paginated shape 58-document-recipient-language.cy.ts's own
		// findClientIdByEmail already accounts for.
		cy.request<{ clients: { id: string; name: string; customFields?: Record<string, unknown> }[] }>({
			url: `${api}/api/clients`,
		})
			.its("body")
			.then((body) => {
				const created = body.clients.find((c) => c.name === "Custom Fields Client SARL");
				expect(created, "le client créé est bien retrouvé par l'API").to.exist;
				expect(created?.customFields?.loyalty_tier).to.eq("gold");
			});
	});

	it("archiving a definition removes it from NEW forms but keeps rendering an already-recorded value", () => {
		listDefinitions().then((definitions) => {
			const costCenter = definitions.find((d) => d.label === "Cost Center")!;

			cy.visit("/settings/customFields");
			clickRowMenuItem(`custom-field-menu-${costCenter.id}`, `custom-field-archive-button-${costCenter.id}`);
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");
			cy.get(`[data-cy="custom-field-row-archived-${costCenter.id}"]`).should("be.visible");

			// A FRESH create dialog no longer offers "Cost Center" at all — checked on "Details" (the
			// wizard's first step, where a required custom field would otherwise have landed).
			openExpenseCreateDialog();
			cy.get('[data-cy="document-field-custom:cost_center-input"]').should("not.exist");
			// "Internal Notes" (optional) is on "Options", one step later — the native required
			// fields have to be filled first to reach it.
			fillMinimalExpenseNativeFields("Checking archived custom field visibility");
			cy.continueDocumentWizard(); // Details -> Options
			cy.get('[data-cy="document-field-custom:internal_notes-input"]').should("exist");

			// The document list still shows the value on the record that already had one — an
			// archived definition never erases a fact already on file (schema.prisma's own header).
			cy.visit("/documents/expense");
			listExpenses().then((expenses) => {
				const created = expenses.find((e) => e.data.description === "Client dinner with cost center");
				cy.get(`[data-cy="document-list-row-${created!.id}"]`, { timeout: 15000 }).should(
					"contain.text",
					"Cost Center: CC-42",
				);
			});

			cy.request<CustomFieldDefinition[]>({
				url: `${api}/api/custom-fields/resolved?target=DOCUMENT&typeId=expense`,
			})
				.its("body")
				.then((activeFields) => {
					expect(activeFields.some((f) => f.key === "custom:cost_center")).to.eq(false);
				});
		});
	});

	it("restoring the archived definition offers it again on a fresh form", () => {
		listDefinitions().then((definitions) => {
			const costCenter = definitions.find((d) => d.label === "Cost Center")!;
			expect(costCenter.archivedAt, "toujours archivée avant restauration").to.not.be.null;

			cy.visit("/settings/customFields");
			clickRowMenuItem(`custom-field-menu-${costCenter.id}`, `custom-field-restore-button-${costCenter.id}`);
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");
			cy.get(`[data-cy="custom-field-row-archived-${costCenter.id}"]`).should("not.exist");

			openExpenseCreateDialog();
			// `exist`, not `be.visible` — same reasoning as the archived counterpart just above
			// (`not.exist`, never a visibility check), and as openExpenseCreateDialog's own comment.
			cy.get('[data-cy="document-field-custom:cost_center-input"]').should("exist");
		});
	});
});
