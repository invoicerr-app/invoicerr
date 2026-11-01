export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * The document line editor shared by quotes, invoices, credit notes and received invoices: the same
 * line fields everywhere, a quote converted or an invoice duplicated with its due date recomputed
 * from the default delay, the unit combobox, the catalog search loader, and the corrected lines of a
 * new credit note checked as soon as an invoice is picked.
 */
import { FRENCH_BUYER_IDENTIFIERS } from "../fixtures/identifiers";

const api = Cypress.env("apiUrl");

type Line = Record<string, unknown>;
type DescriptorField = { key: string; fields?: DescriptorField[] };

const NO_TERMS = { quoteDueDays: null, quoteDueMode: null, invoiceDueDays: null, invoiceDueMode: null };

function addDays(isoDay: string, days: number): string {
	const date = new Date(`${isoDay.slice(0, 10)}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function configureInvoiceTerm(days: number | null) {
	cy.request("POST", `${api}/api/company/info`, {
		...NO_TERMS,
		invoiceDueDays: days,
		invoiceDueMode: days === null ? null : "net",
	})
		.its("status")
		.should("be.oneOf", [200, 201]);
}

function createClient(name: string) {
	return cy
		.request("POST", `${api}/api/clients`, {
			name,
			address: "1 Rue Quelconque",
			postalCode: "75002",
			city: "Paris",
			country: "France",
			currency: "EUR",
			isActive: true,
			type: "COMPANY",
			identifiers: FRENCH_BUYER_IDENTIFIERS,
		})
		.then((res) => res.body.id as string);
}

function lineKeys(typeId: string) {
	return cy.request(`${api}/api/documents/types/${typeId}`).then((res) => {
		const lines = (res.body.fields as DescriptorField[]).find((field) => field.key === "lines");
		return (lines?.fields ?? []).map((field) => field.key).sort();
	});
}

function saveDraft(typeId: string, data: Record<string, unknown>) {
	return cy
		.request("POST", `${api}/api/documents/types/${typeId}/actions/save-draft`, { data })
		.then((res) => res.body.document as { id: string; data: Record<string, unknown> });
}

function runAction(typeId: string, actionId: string, document: { id: string; data: Record<string, unknown> }) {
	return cy
		.request("POST", `${api}/api/documents/types/${typeId}/actions/${actionId}`, {
			documentId: document.id,
			data: document.data,
		})
		.then((res) => res.body.document as { id: string; data: Record<string, unknown> });
}

const FULL_LINE: Line = {
	description: "Audit",
	quantity: 3,
	unit: "HUR",
	unitPrice: 120,
	vatRate: "20",
	discountPercent: 10,
	date: "2026-09-02",
	supplyType: "SERVICES",
};

function openCreateDialog(typeId: "quote" | "invoice") {
	cy.visit(`/documents/${typeId}`, { timeout: 20000 });
	cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
	cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");
}

function continueToLines() {
	cy.pickDocumentClient();
	cy.pickToday('[data-cy="document-field-issueDate-input"]');
	cy.pickDocumentFieldOption("currency", "eur");
	cy.get('[data-cy="document-field-lines-add-row"]').click();
	cy.get('[data-cy="document-field-lines-row-0"]').should("exist");
}

function startDocumentAtLines(typeId: "quote" | "invoice") {
	openCreateDialog(typeId);
	continueToLines();
}

describe("Document line editor", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	describe("one line shape for every document", () => {
		it("offers the same line fields on quotes, invoices, credit notes and received invoices", () => {
			lineKeys("invoice").then((invoiceKeys) => {
				expect(invoiceKeys).to.include("unit");
				for (const typeId of ["quote", "credit-note", "received-invoice"]) {
					lineKeys(typeId).then((keys) => {
						const shared = keys.filter((key) => key !== "option");
						expect(shared, `${typeId} line fields`).to.deep.eq(invoiceKeys);
					});
				}
			});
		});

		it("shows the unit on a quote line", () => {
			startDocumentAtLines("quote");
			cy.get('input[name="lines.0.unit"]').should("be.visible");
		});

		it("passes axe on the create dialog and on its line rows", () => {
			openCreateDialog("invoice");
			cy.assertAccessible();
			continueToLines();
			cy.get('[data-cy="document-field-lines-add-row"]').click();
			cy.get('[data-cy="document-field-lines-row-1"]').should("exist");
			cy.assertAccessible();
		});

		it("carries every line field over when a quote becomes an invoice", () => {
			createClient("Client Conversion SARL").then((client) => {
				saveDraft("quote", {
					client,
					issueDate: "2026-09-01",
					currency: "EUR",
					lines: [FULL_LINE],
				}).then((quote) => {
					runAction("quote", "convert-to-invoice", quote).then((invoice) => {
						const [line] = invoice.data.lines as Line[];
						expect(line).to.deep.include(FULL_LINE);
					});
				});
			});
		});
	});

	describe("due date of an invoice created from another document", () => {
		it("from a quote: invoice date plus the company default delay, never the quote validity", () => {
			configureInvoiceTerm(45);
			createClient("Client Echeance SARL").then((client) => {
				saveDraft("quote", {
					client,
					issueDate: "2026-01-01",
					dueDate: "2026-01-31",
					currency: "EUR",
					lines: [FULL_LINE],
				}).then((quote) => {
					runAction("quote", "convert-to-invoice", quote).then((invoice) => {
						const issueDate = String(invoice.data.issueDate);
						expect(invoice.data.dueDate).to.eq(addDays(issueDate, 45));
					});
				});
			});
		});

		it("from a quote with no company default: the country's default payment term", () => {
			configureInvoiceTerm(null);
			createClient("Client Defaut Pays SARL").then((client) => {
				saveDraft("quote", { client, issueDate: "2026-01-01", currency: "EUR", lines: [FULL_LINE] }).then(
					(quote) => {
						runAction("quote", "convert-to-invoice", quote).then((invoice) => {
							expect(invoice.data.dueDate).to.eq(addDays(String(invoice.data.issueDate), 30));
						});
					},
				);
			});
		});

		it("duplicating an invoice recomputes the due date from the new date", () => {
			configureInvoiceTerm(45);
			createClient("Client Duplication SARL").then((client) => {
				saveDraft("invoice", {
					client,
					issueDate: "2026-03-01",
					dueDate: "2026-03-05",
					currency: "EUR",
					lines: [FULL_LINE],
				}).then((source) => {
					runAction("invoice", "duplicate", source).then((copy) => {
						const issueDate = String(copy.data.issueDate);
						expect(issueDate, "the duplicate is dated today").not.to.eq("2026-03-01");
						expect(copy.data.dueDate).to.eq(addDays(issueDate, 45));
					});
				});
			});
		});
	});

	describe("unit combobox", () => {
		const unitInput = 'input[name="lines.0.unit"]';
		const options = '[data-cy="document-field-unit-input-options"]';

		it("opens on click, filters while typing, picks with the keyboard and keeps free text", () => {
			startDocumentAtLines("invoice");
			cy.get(unitInput).click();
			cy.get(options).should("be.visible").find('[role="option"]').should("have.length.greaterThan", 5);
			cy.get(options).should("contain.text", "Hour").and("contain.text", "Piece");

			cy.get(unitInput).type("kilo");
			cy.get(`${options} [role="option"]`).should("have.length", 2);
			cy.get(unitInput).type("{downArrow}{enter}");
			cy.get(options).should("not.exist");
			cy.get(unitInput).should("have.value", "Kilogram");

			cy.get(unitInput).clear();
			cy.get(unitInput).type("sprint");
			cy.get(unitInput).blur();
			cy.get(unitInput).should("have.value", "sprint");
		});

		it("opens on keyboard focus and closes on Escape without closing the dialog", () => {
			startDocumentAtLines("invoice");
			cy.get(unitInput).scrollIntoView().focus();
			cy.get(options).should("be.visible");
			cy.get(unitInput).type("{esc}");
			cy.get(options).should("not.exist");
			cy.contains("Discard changes?").should("not.exist");
			cy.get('[data-cy="document-create-dialog"]').should("be.visible");
		});
	});

	describe("catalog search loader", () => {
		before(() => {
			cy.login();
			cy.request("POST", `${api}/api/articles`, { name: "Loader widget", unitPrice: 10, vatRate: 20 });
		});

		it("shows a loader while the search is in flight, then the results", () => {
			cy.intercept({ method: "GET", pathname: "/api/documents/references/article/search" }, (req) => {
				req.reply({ delay: 4000, body: [{ id: "slow-article", label: "Loader widget" }] });
			}).as("slowSearch");
			startDocumentAtLines("invoice");
			cy.get('input[name="lines.0.description"]').type("Loader");
			// "exist" and a real size rather than "be.visible": the field sits at the clipped top edge of the
			// scrolling dialog body, which Cypress counts as hidden.
			cy.get('[data-cy="document-field-description-input-loading"]', { timeout: 3500 }).should(($loader) => {
				expect($loader[0].getBoundingClientRect().width, "the spinner is drawn").to.be.greaterThan(0);
			});
			cy.wait("@slowSearch");
			cy.get('[data-cy="document-field-description-input-loading"]').should("not.exist");
			cy.get('[data-cy="document-field-description-input-suggestions"]').should("contain.text", "Loader widget");
		});

		it("says when nothing matches", () => {
			startDocumentAtLines("invoice");
			cy.get('input[name="lines.0.description"]').type("zzz-nothing-matches");
			cy.get('[data-cy="document-field-description-input-no-match"]', { timeout: 5000 }).should("be.visible");
		});

		it("never flashes the loader for a fast answer", () => {
			cy.intercept({ method: "GET", pathname: "/api/documents/references/article/search" }).as("fastSearch");
			startDocumentAtLines("invoice");
			cy.get('input[name="lines.0.description"]').type("Loader");
			cy.wait("@fastSearch");
			cy.get('[data-cy="document-field-description-input-suggestions"]').should("contain.text", "Loader widget");
			cy.get('[data-cy="document-field-description-input-loading"]').should("not.exist");
		});
	});

	describe("new credit note form", () => {
		const corrected = '[data-cy^="document-field-correctedLines-row-"][data-cy$="-checkbox"]';
		const dates = { issueDate: "2026-08-10", dueDate: "2026-09-10" };

		function validatedInvoice(clientName: string, descriptions: string[]) {
			return createClient(clientName).then((client) => {
				const data = {
					client,
					...dates,
					currency: "EUR",
					lines: descriptions.map((description) => ({ ...FULL_LINE, description })),
				};
				return saveDraft("invoice", data).then((draft) =>
					runAction("invoice", "validate", draft).then(() => draft.id),
				);
			});
		}

		function pickInvoice(clientName: string) {
			cy.openSearchSelect("document-field-invoice-input");
			cy.contains('[data-cy="document-field-invoice-input-options"] button', clientName).click();
		}

		function openNewCreditNote() {
			cy.visit("/documents/credit-note", { timeout: 20000 });
			cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
		}

		it("asks for the corrected invoice before the dates", () => {
			openNewCreditNote();
			cy.get('[data-cy="document-form"] [data-cy^="document-field-"]', { timeout: 15000 }).then(($els) => {
				const keys = [...$els]
					.map((el) => el.getAttribute("data-cy") ?? "")
					.filter((cy) => /^document-field-[A-Za-z]+$/.test(cy))
					.map((cy) => cy.replace("document-field-", ""));
				expect(keys.slice(0, 3)).to.deep.eq(["invoice", "issueDate", "currency"]);
			});
		});

		it("checks every line of the picked invoice, and again after switching invoices", () => {
			validatedInvoice("Avoir Premier SARL", ["One", "Two"]).then(() => {
				validatedInvoice("Avoir Second SARL", ["Three", "Four", "Five"]).then(() => {
					openNewCreditNote();
					pickInvoice("Avoir Premier SARL");
					cy.pickToday('[data-cy="document-field-issueDate-input"]');
					cy.get(corrected, { timeout: 10000 }).should("have.length", 2).and("be.checked");
					cy.get(corrected).first().uncheck();

					pickInvoice("Avoir Second SARL");
					cy.get(corrected, { timeout: 10000 }).should("have.length", 3).and("be.checked");
				});
			});
		});

		it("saves the lines of the newly picked invoice after picking another invoice", () => {
			validatedInvoice("Avoir Chip Premier SARL", ["One", "Two"]).then(() => {
				validatedInvoice("Avoir Chip Second SARL", ["Three", "Four", "Five"]).then((secondId) => {
					openNewCreditNote();
					pickInvoice("Avoir Chip Premier SARL");
					cy.pickToday('[data-cy="document-field-issueDate-input"]');
					cy.get(corrected, { timeout: 10000 }).should("have.length", 2).and("be.checked");

					pickInvoice("Avoir Chip Second SARL");
					cy.get(corrected, { timeout: 10000 }).should("have.length", 3);

					cy.intercept("POST", `${api}/api/documents/types/credit-note/actions/save-draft`).as("save");
					cy.get('[data-cy="document-action-save-draft"]').scrollIntoView().click();
					cy.wait("@save").then((interception) => {
						expect(interception.response?.statusCode).to.be.oneOf([200, 201]);
						const id = interception.response?.body?.document?.id as string;
						cy.request(`${api}/api/documents/${id}?typeId=credit-note`).then(({ body }) => {
							expect(body.data.invoice).to.eq(secondId);
							expect(body.data.correctedLines).to.have.length(3);
						});
					});
				});
			});
		});
	});
});
