export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Email templates PER DOCUMENT TYPE (`Settings > Email Templates`, `/settings/email` tab) —
 * until now with NO e2e coverage at all: `09-settings.cy.ts` never visits this tab, and
 * `23-document-email.cy.ts` only proves a single fact (a real click on "Send" attaches the PDF and
 * interpolates the subject), never that the EDITOR itself saves, revokes, or refuses what the
 * server refuses. The placeholder grammar (simple `{name}` braces), the contract "an
 * unknown placeholder is FLAGGED, never refused" and the opposite contract "an empty subject, or
 * neither body nor html, IS refused" are already proven at the unit level on the server side
 * (`backend/src/modules/documents/actions/email-template.spec.ts`,
 * `documents.service.email-templates.spec.ts`); this file proves that the SCREEN honors exactly
 * this same contract, end to end.
 *
 * Usual discipline: ACTIONS go through the screen (typing, clicking), the ASSERTIONS that
 * matter read the API back — never the DOM we just filled in as proof of what is
 * actually stored.
 *
 * The body field is a TipTap WYSIWYG editor (`components/ui/rich-text-editor.tsx`), not a
 * textarea: it edits `html` only, and always saves `body: ""` alongside it — the server DERIVES
 * the plain-text part from the html at render time (`deriveTextFromHtml`), a state the engine
 * already had to support for every html-only template. So a save's own assertion below reads
 * `stored.html`, never `stored.body`, and typing goes through
 * `[data-testid="rich-text-editor"] .ProseMirror`, the editor's own contenteditable root.
 *
 * Two types chosen deliberately for their different SHAPES (see this same file on the backend,
 * `derives the right vocabulary for each shipped type`):
 *  - `quote` / `invoice`: a client (`recipientName`) and priced lines (`totalGross`).
 *  - `expense`: neither one — the minimal vocabulary (`companyName`, `displayNumber`,
 *    `typeLabel`).
 * It is `invoice`/`expense`, not `invoice`/`quote`, that proves the vocabulary is GENUINELY
 * per type: `quote` and `invoice` actually share the same set of keys (both have a client AND
 * priced lines), only the example text differs.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

interface DocumentTypeSummary {
	id: string;
	label: string;
}

interface DocumentEmailTemplateApiView {
	typeId: string;
	label: string;
	subject: string;
	body: string;
	html?: string;
	source: "company" | "descriptor" | "generic";
	variables: Record<string, string>;
}

/** Reads back the RESOLVED template of a type — the same read the screen itself does on open, but
 *  here as evidence independent of the DOM. */
function getDocumentEmailTemplate(typeId: string) {
	return cy
		.request({ url: `${api}/api/documents/types/${typeId}/email-template` })
		.its("body") as Cypress.Chainable<DocumentEmailTemplateApiView>;
}

/** Opens a type's editor via a real click on its toggle, and waits for the subject field to be
 *  properly mounted before continuing — the editor only exists in the DOM while the row is expanded
 *  (`templates.settings.tsx`'s own "only one editor open at a time"). Only requires EXISTENCE, not
 *  visibility: `<main>` (`-[tab].tsx`) is an `overflow-auto` panel, and a card for a type
 *  further down the list (e.g. "invoice") opens outside the visible viewport until it has been
 *  scrolled to — Cypress then rightly reports a field "clipped by a parent... overflow", which
 *  is not a screen bug. The real actions that follow (`.clear()`/`.type()`) scroll
 *  the element into view themselves before acting. */
function openTemplateEditor(typeId: string) {
	cy.get(`[data-cy="email-template-toggle-${typeId}"]`, { timeout: 15000 }).click();
	cy.get(`[data-cy="email-template-subject-${typeId}"]`, { timeout: 10000 }).should("exist");
}

describe("Settings — email templates per document type", () => {
	// A single capture of "quote"'s DEFAULT template, taken before any test touches it —
	// it is THIS template (not a hand-copied value, which would diverge the day the
	// descriptor changes) that the revocation test must find again.
	let quoteDefaultTemplate: DocumentEmailTemplateApiView;

	before(() => {
		cy.resetAndSeed();
		cy.login();
		getDocumentEmailTemplate("quote").then((template) => {
			quoteDefaultTemplate = template;
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it("the tab loads at /settings/email and lists every document type with the template that actually applies", () => {
		cy.request({ url: `${api}/api/documents/types` })
			.its("body")
			.then((types: DocumentTypeSummary[]) => {
				const ids = types.map((type) => type.id);
				// The five types this branch registers (documents-core.module.ts) — if one of them
				// silently disappeared from the registry, THIS is where it would break, not only
				// on the screen.
				expect(ids, "les types de document que cette branche enregistre").to.include.members([
					"quote",
					"invoice",
					"credit-note",
					"expense",
					"received-invoice",
				]);

				cy.request({ url: `${api}/api/documents/email-templates` })
					.its("body")
					.then((templates: DocumentEmailTemplateApiView[]) => {
						cy.visit("/settings/email");
						cy.url().should("include", "/settings/email");

						for (const template of templates) {
							cy.get(`[data-cy="email-template-card-${template.typeId}"]`, { timeout: 15000 }).should(
								"exist",
							);
						}

						// Expanding ONE type shows the editor PRE-FILLED with exactly what the API says
						// applies — the proof that the screen loads the RESOLVED template, not an empty
						// form nor hard-coded text.
						const invoiceTemplate = templates.find((t) => t.typeId === "invoice");
						expect(invoiceTemplate, "le type invoice a une entrée").to.exist;
						openTemplateEditor("invoice");
						cy.get('[data-cy="email-template-subject-invoice"]').should(
							"have.value",
							invoiceTemplate!.subject,
						);
						// The body field is a rich-text editor now, not an input — pre-fill is proven by its
						// rendered TEXT containing the resolved template's own first line, rather than by an
						// exact `.value` match that a `\n` → paragraph/`<br>` conversion could never satisfy.
						cy.get('[data-testid="rich-text-editor"] .ProseMirror').should(
							"contain.text",
							invoiceTemplate!.body.split("\n")[0],
						);
					});
			});
	});

	it("editing a type's subject and body via the screen saves them, and the API reports a company override", () => {
		const distinctiveSubject = "Sujet distinctif e2e {displayNumber}";
		const distinctiveBody = "Corps distinctif e2e — rien à voir avec le gabarit livré.";

		cy.visit("/settings/email");
		openTemplateEditor("quote");

		// Named BEFORE the click, asserted BEFORE the toast: a toast is UI state the screen could show
		// for the wrong reason, the request's own status code cannot lie about whether the save actually
		// reached the server (same discipline as `65-company-mail-settings.cy.ts`'s own save test).
		cy.intercept("PUT", `${api}/api/documents/types/quote/email-template`).as("saveQuoteTemplate");

		// `{displayNumber}` contains braces that a cypress `.type()` would otherwise interpret as
		// a special sequence (`{selectall}`, etc.) — disabled here to type the literal brace.
		cy.get('[data-cy="email-template-subject-quote"]')
			.clear()
			.type(distinctiveSubject, { parseSpecialCharSequences: false });
		// The body field is the TipTap editor's own contenteditable root — `.clear()` works on a
		// `contenteditable` element exactly like it does on an input/textarea. `{ delay: 20 }`: at
		// Cypress' default keystroke rate, ProseMirror's own controlled-value round trip (every
		// keystroke's `onUpdate` → `onChange` → the `value` prop → `rich-text-editor.tsx`'s own
		// external-sync effect comparing `value !== editor.getHTML()`) can still be applying a STALE
		// `value` from a couple of keystrokes back exactly when the next one lands, and that effect's
		// `setContent()` silently drops the character in flight — reproduced on CI run 34951199307 as
		// swallowed SPACES specifically (`Corpsdistinctif`, `àvoir`, `avecle`), never a wrong or
		// duplicated character. A real user's typing cadence (100ms+/keystroke) never gets close to
		// this race, so this is test input speed, not a product bug — same conclusion this file's own
		// header draws for the `{selectall}` brace-escaping a line above.
		cy.get('[data-testid="rich-text-editor"] .ProseMirror').clear().type(distinctiveBody, { delay: 20 });
		cy.get('[data-cy="email-template-save-quote"]').click();

		cy.wait("@saveQuoteTemplate").then((interception) => {
			expect(
				interception.response?.statusCode,
				"PUT /api/documents/types/quote/email-template must succeed",
			).to.eq(200);
		});

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "saved successfully");

		getDocumentEmailTemplate("quote").then((stored) => {
			expect(stored.subject, "exactement ce qui a été tapé, sans altération").to.eq(distinctiveSubject);
			// The rich-text editor stores html, not the plain-text `body` column the old textarea wrote —
			// see this file's own header.
			expect(stored.html, "exactement ce qui a été tapé, sans altération").to.contain(distinctiveBody);
			expect(
				stored.body,
				"le texte brut n'est plus écrit par cet éditeur — il est dérivé côté serveur à l'envoi",
			).to.eq("");
			expect(stored.source, "la société a maintenant sa propre surcharge pour ce type").to.eq("company");
		});
	});

	it("revoking via the screen brings back the shipped template, and source is no longer an override", () => {
		cy.visit("/settings/email");

		// "Reset to default" lives in the row's own "⋯" menu (templates.settings.tsx's row grammar:
		// only "Edit"/"Close" sits directly on a template row, every other action is one level down) —
		// it needs no open editor, since it operates on the STORED override, not on unsaved form state.
		cy.get('[data-cy="email-template-menu-quote"]', { timeout: 15000 }).click();
		cy.wait(50);
		cy.get('[data-cy="email-template-reset-quote"]').click();
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "reset to its default");

		getDocumentEmailTemplate("quote").then((restored) => {
			expect(restored.source, "ce n'est plus une surcharge de la société").to.not.eq("company");
			expect(
				restored.subject,
				"revenu exactement au gabarit livré capturé avant que quoi que ce soit n'y touche",
			).to.eq(quoteDefaultTemplate.subject);
			expect(restored.body).to.eq(quoteDefaultTemplate.body);
		});
	});

	it("an unknown placeholder saves SUCCESSFULLY and surfaces a warning — flagged, never refused", () => {
		const subjectWithTypo = "Merci pour votre devis {notAThing}";

		cy.visit("/settings/email");
		openTemplateEditor("quote");

		// No warning before this save — the state was just reloaded from scratch.
		cy.get('[data-cy="email-template-warnings"]').should("not.exist");

		cy.get('[data-cy="email-template-subject-quote"]')
			.clear()
			.type(subjectWithTypo, { parseSpecialCharSequences: false });
		cy.get('[data-cy="email-template-save-quote"]').click();

		// The save SUCCEEDED (never a 400) — a success toast, never an error toast.
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "saved successfully");

		cy.get('[data-cy="email-template-warnings"]', { timeout: 10000 })
			.should("exist")
			.and("contain.text", "notAThing");

		getDocumentEmailTemplate("quote").then((stored) => {
			expect(
				stored.subject,
				"la faute de frappe traverse jusqu'au stockage — signalée, jamais amputée ni refusée",
			).to.include("{notAThing}");
		});
	});

	it("refuses an empty subject — the Save button disables itself rather than sending a request, and the API itself replies 400", () => {
		cy.visit("/settings/email");
		openTemplateEditor("quote");

		cy.get('[data-cy="email-template-subject-quote"]').clear();
		cy.get('[data-cy="email-template-save-quote"]').should("be.disabled");

		// The other side of the same contract, proven directly against the API — never relying only
		// on what the screen prevents doing.
		cy.request({
			method: "PUT",
			url: `${api}/api/documents/types/quote/email-template`,
			body: { subject: "", body: "Un corps" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "le serveur lui-même refuse un sujet vide").to.eq(400);
		});
	});

	it("the placeholder vocabulary is GENUINELY per type — invoice and expense do not advertise the same list", () => {
		getDocumentEmailTemplate("invoice").then((invoiceTemplate) => {
			getDocumentEmailTemplate("expense").then((expenseTemplate) => {
				const invoiceKeys = Object.keys(invoiceTemplate.variables).sort();
				const expenseKeys = Object.keys(expenseTemplate.variables).sort();

				expect(
					invoiceKeys,
					"invoice a un champ client ET des lignes chiffrées — les deux placeholders dérivés",
				).to.include.members(["recipientName", "totalGross"]);
				expect(
					expenseKeys,
					"une dépense n'a ni référence client ni total de lignes — jamais un placeholder qu'un vrai envoi ne pourrait remplir",
				).to.not.include.members(["recipientName", "totalGross"]);
				expect(
					invoiceKeys,
					"les deux listes sont réellement différentes, pas le même ensemble simplement relabellisé",
				).to.not.deep.equal(expenseKeys);
			});
		});
	});

	// The end-to-end payoff: the subject configured via the screen must be the one Mailpit actually
	// receives — the same discipline as 23-document-email.cy.ts (Mailpit read-back, never guessed),
	// and the same click mechanics as 42-webhooks.cy.ts for sending an invoice: invoice's "send"
	// action declares NO param (invoice.descriptor.ts), so a real click executes it directly
	// with no dialog — see use-document-action-runner.ts's own `if (!action.params ...)`.
	it("a distinctive subject configured for invoice is found, interpolated, in the real email sent", () => {
		const marker = "E2E-TEMPLATE-MARKER";
		const distinctiveSubject = `${marker} {displayNumber}`;

		cy.visit("/settings/email");
		openTemplateEditor("invoice");
		cy.get('[data-cy="email-template-subject-invoice"]')
			.clear()
			.type(distinctiveSubject, { parseSpecialCharSequences: false });
		cy.get('[data-cy="email-template-save-invoice"]').click();
		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "saved successfully");

		cy.clearEmails();

		// With no transport configured, "send" flatly refuses (501, `invoice-actions.ts`'s own
		// `getCompanyInvoiceTransportId` guard) — a fresh `resetAndSeed()` never configures one, so
		// this setting is a prerequisite to the click, not the thing under test here (the same step
		// as 42-webhooks.cy.ts before its own invoice send).
		cy.request({
			method: "POST",
			url: `${api}/api/company/info`,
			body: { invoiceTransportId: "email" },
			failOnStatusCode: false,
		}).then((res) => {
			expect(res.status, "transport email configuré").to.be.oneOf([200, 201]);
		});

		cy.request({
			method: "POST",
			url: `${api}/api/clients`,
			body: {
				name: "Email Template E2E Co",
				contactEmail: "email-template-e2e-client@example.com",
				currency: "EUR",
				country: "France",
				countryCode: "FR",
				address: "1 Template Street",
				city: "Paris",
				postalCode: "75004",
				isActive: true,
				type: "COMPANY",
			},
			failOnStatusCode: false,
		}).then((created) => {
			expect(created.status, "client (avec un vrai email de contact) créé").to.eq(201);
			const clientId = created.body.id as string;

			cy.request({
				method: "POST",
				url: `${api}/api/documents/types/invoice/actions/save-draft`,
				body: {
					data: {
						client: clientId,
						issueDate: "2026-08-31",
						dueDate: "2026-09-30",
						currency: "EUR",
						lines: [
							{ description: "Consulting", quantity: 1, unit: "unit", unitPrice: 100, vatRate: "20" },
						],
					},
				},
				failOnStatusCode: false,
			}).then((saved) => {
				expect(saved.status, "brouillon de facture créé").to.be.oneOf([200, 201]);
				const invoiceId = saved.body?.document?.id as string;
				expect(invoiceId, "le brouillon a un identifiant").to.be.a("string");

				cy.visit("/documents/invoice");
				cy.runDocumentRowAction(invoiceId, "send");
				// The `timeout` that actually governs a `.should()` retry belongs on the LAST queryable
				// command before it — putting it on the outer `.get()` alone (as a first pass here did)
				// silently caps the retry at Cypress' 4s default instead of the 20s this async send
				// (BullMQ) genuinely needs.
				cy.get(`[data-cy="document-list-row-${invoiceId}"]`)
					.find('[data-cy="document-status-badge"]', { timeout: 20000 })
					.should("contain.text", "Sent");

				cy.request({ url: `${api}/api/documents/${invoiceId}?typeId=invoice` })
					.its("body")
					.then((doc) => {
						expect(doc.displayNumber, "la facture envoyée porte un numéro").to.be.a("string");

						cy.getLastEmail().then((message: any) => {
							expect(
								message.To?.[0]?.Address,
								"le message va au contact du client réellement facturé",
							).to.eq("email-template-e2e-client@example.com");
							expect(
								message.Subject,
								"le sujet du VRAI message porte à la fois le marqueur du gabarit et le displayNumber interpolé",
							).to.eq(`${marker} ${doc.displayNumber}`);
						});
					});
			});
		});
	});
});
