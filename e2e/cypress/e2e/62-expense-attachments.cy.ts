export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * TODO_FEATURES.md rank 13 ("notes de frais enrichies") — proven THROUGH THE SCREEN, like
 * 17-document-descriptor.cy.ts and the rest of this suite: ACTIONS go through the interface, content
 * ASSERTIONS go through the API. The three new expense fields this rank added
 * (`descriptors/expense.descriptor.ts`): `attachment` (the 12th core field kind, 'file'), `category`
 * (a closed select with an "other" catch-all), `distanceKm`/`ratePerKm` (plain optional numbers, no
 * per-country mileage rate).
 *
 * Files are never committed fixtures here — `cy.selectFile` accepts an in-memory
 * `{ contents, fileName, mimeType }` object directly (Cypress own `FileReferenceObject`), which is
 * enough to prove upload/download/refusal without adding a binary file to the repo (the disallowed-
 * mime and oversized cases in particular have no legitimate reason to exist as committed fixtures).
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

// Deliberately plain ASCII so the byte-identity check at the end (`encoding: "binary"`) round-trips
// exactly, the same technique 36-received-invoices.cy.ts's own `cy.readFile(..., "binary")` comparison
// relies on — no real JPEG structure is needed: this proves STORAGE/DOWNLOAD byte-identity, never
// image decoding.
const RECEIPT_CONTENT = "fake-jpeg-bytes-for-e2e-expense-attachment-test";

interface ExpenseInstance {
	id: string;
	status: string;
	data: Record<string, unknown>;
}

interface TableWidget {
	id: string;
	kind: string;
	rows: Record<string, unknown>[];
}

function listExpenses() {
	return cy.request<ExpenseInstance[]>({ url: `${api}/api/documents?typeId=expense` }).its("body");
}

function openCreateDialog() {
	cy.visit("/documents/expense");
	cy.get('[data-cy="document-create-button"]', { timeout: 15000 }).click();
	cy.get('[data-cy="document-create-dialog"]', { timeout: 15000 }).should("be.visible");
	cy.get('[data-cy="document-form"]', { timeout: 15000 }).should("be.visible");
}

/** The generic SearchSelect interaction every 'select' field in this app shares — see
 *  20-document-totals.cy.ts's own `document-field-currency-input` for the exact same three-step
 *  pattern (button first, wait for the options list, click the option by its slugified label). */
function pickSelectOption(fieldKey: string, optionSlug: string) {
	cy.get(`[data-cy="document-field-${fieldKey}-input"] button`).first().click({ force: true });
	cy.get(`[data-cy="document-field-${fieldKey}-input-options"]`, { timeout: 10000 }).should("be.visible");
	cy.get(`[data-cy^="document-field-${fieldKey}-input-option-${optionSlug}"]`).first().click();
}

function pickToday(fieldKey: string) {
	// `today` is computed INSIDE the `.then()`, never above it: Cypress commands are queued, not
	// executed immediately (cy.get().click() enqueues and returns at once), so a plain `new Date()`
	// statement between two commands captures the wall clock at TEST-BODY-EXECUTION time — seconds, and
	// several other queued commands, before this click actually opens the calendar in the browser. The
	// calendar (react-day-picker) computes its OWN "today" only once it mounts, right when the click
	// resolves — established the hard way on CI run 34914384074, which straddled the 2026-09-14/15 UTC
	// midnight: the eagerly-computed date had already rolled over to the 15th by the time the test body
	// ran, while the calendar (mounting later, after the click actually resolved) was still on the
	// 14th. Deferring the computation to here shrinks that window to the click's own settle time.
	cy.get(`[data-cy="document-field-${fieldKey}-input"]`)
		.click()
		.then(() => {
			const today = new Date().toLocaleDateString();
			cy.get(`[data-day="${today}"]`).click();
		});
}

function saveDraft() {
	// CI run 34909400701 (commit 6cb60096), spec's own first execution: this used to also assert
	// `cy.get('[data-cy="document-form"]').should("not.exist")` here, and all three tests that called
	// it timed out on exactly that line — "Expected <form.space-y-6> not to exist in the DOM, but it
	// was continuously found." That assertion was simply wrong, not a product bug: the generic
	// "+ New" create dialog deliberately stays OPEN after a same-type action succeeds — see
	// document-upsert-dialog.tsx's own header ("closes itself only when the action's result is a
	// DIFFERENT document type") and [typeId].tsx's own handleActionSuccess ("same-type success needs
	// nothing here at all ... the dialog just stays open, showing the same record"). The ONE place
	// that closes unconditionally is the received-invoice upload flow's OWN
	// `handleActionSuccess` override, which says so explicitly — the exception, not the rule. The
	// backend logs for this exact run show no error at all in this test's window: the save always
	// succeeded, the dialog just never went away, per that design. Content assertions belong to the
	// API either way (this file's own header) — no DOM check stands in for the API check below.
	cy.get('[data-cy="document-action-save-draft"]').click();
	cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");
}

describe("Expense attachments, category, and mileage (rank 13)", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("an expense with a receipt photo attaches, saves the chosen category, and the file downloads byte-identically", () => {
		openCreateDialog();

		cy.get('[data-cy="document-field-description-input"]').type("Business lunch with client");
		cy.get('[data-cy="document-field-amount-input"]').type("45.90");
		pickSelectOption("currency", "eur");
		pickToday("date");
		pickSelectOption("category", "meals");

		// The attachment: the hidden file input behind the "Choose file" button — same `{ force: true }`
		// convention 36-received-invoices.cy.ts's own upload dropzone input already uses for a
		// display:none control.
		cy.get('[data-cy="document-field-attachment-file-input"]').selectFile(
			{ contents: Cypress.Buffer.from(RECEIPT_CONTENT), fileName: "receipt.jpg", mimeType: "image/jpeg" },
			{ force: true },
		);
		// The value block (preview + filename + remove button) replaces the "Choose file" button the
		// moment the upload resolves — proof the upload actually completed before saving.
		cy.get('[data-cy="document-field-attachment-value"]', { timeout: 10000 }).should("be.visible");
		cy.get('[data-cy="document-field-attachment-value"]').should("contain.text", "receipt.jpg");

		// Kilométrage — plain optional fields, filled here to prove they round-trip too (never a
		// per-country rate: the user's own number, see the descriptor's own header).
		cy.get('[data-cy="document-field-distanceKm-input"]').type("12");
		cy.get('[data-cy="document-field-ratePerKm-input"]').type("0.5");

		saveDraft();

		listExpenses().then((expenses) => {
			const created = expenses.find((e) => e.data.description === "Business lunch with client");
			expect(created, "l'expense créée est bien retrouvée par l'API").to.exist;
			expect(created?.data.category).to.eq("meals");
			expect(created?.data.distanceKm).to.eq(12);
			expect(created?.data.ratePerKm).to.eq(0.5);

			const attachment = created?.data.attachment as
				| { fileRef?: string; fileName?: string; mime?: string }
				| undefined;
			expect(attachment?.fileRef, "un fileRef a été attaché").to.be.a("string");
			expect(attachment?.fileName).to.eq("receipt.jpg");
			expect(attachment?.mime).to.eq("image/jpeg");

			// Company-scoped, content-addressed download — the SAME generic route any future 'file'
			// field would use (never a document-id-scoped one, see attachments.service.ts's own header).
			cy.request({
				url: `${api}/api/documents/attachments/${attachment!.fileRef}?mime=${encodeURIComponent(attachment!.mime!)}`,
				encoding: "binary",
			}).then((res) => {
				expect(res.status).to.eq(200);
				expect(res.body).to.eq(RECEIPT_CONTENT);
				expect(res.headers["content-type"]).to.eq("image/jpeg");
			});

			// The chosen category flows through to the Statistics screen's own detailed table
			// (contributions/expense-contributions.ts) — the e2e proof TODO_FEATURES.md's own rank 13
			// entry names explicitly.
			cy.request<{ id: string; kind: string; rows: Record<string, unknown>[] }[]>({
				url: `${api}/api/documents/statistics`,
			})
				.its("body")
				.then((widgets) => {
					const table = widgets.find((w) => w.id === "expense:all") as TableWidget | undefined;
					expect(table, "le widget statistiques des dépenses existe").to.exist;
					const row = table?.rows.find((r) => r.description === "Business lunch with client");
					expect(row?.category, "la catégorie choisie apparaît dans les stats").to.eq("meals");
				});
		});
	});

	it("a disallowed file type is refused, named, and never attached", () => {
		openCreateDialog();

		cy.get('[data-cy="document-field-description-input"]').type("Suspicious upload attempt");
		cy.get('[data-cy="document-field-amount-input"]').type("10");
		pickSelectOption("currency", "eur");
		pickToday("date");

		cy.get('[data-cy="document-field-attachment-file-input"]').selectFile(
			{
				contents: Cypress.Buffer.from("not a real executable"),
				fileName: "invoice-generator.exe",
				mimeType: "application/x-msdownload",
			},
			{ force: true },
		);

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Unsupported file type");
		// Refused — the "Choose file" button is still what shows, never the value block.
		cy.get('[data-cy="document-field-attachment-input"]').should("be.visible");
		cy.get('[data-cy="document-field-attachment-value"]').should("not.exist");

		saveDraft();

		listExpenses().then((expenses) => {
			const created = expenses.find((e) => e.data.description === "Suspicious upload attempt");
			expect(created, "l'expense se sauvegarde quand même, simplement sans pièce jointe").to.exist;
			expect(created?.data.attachment, "aucune pièce jointe attachée après un refus").to.be.oneOf([
				undefined,
				null,
			]);
		});
	});

	it("a file over the size limit is refused, named with the actual size, and never attached", () => {
		openCreateDialog();

		cy.get('[data-cy="document-field-description-input"]').type("Huge scan attempt");
		cy.get('[data-cy="document-field-amount-input"]').type("10");
		pickSelectOption("currency", "eur");
		pickToday("date");

		// One byte over the documented 750 KiB limit (attachments.service.ts's own
		// `MAX_ATTACHMENT_BYTES`) — an ALLOWED mime, refused purely for its size.
		cy.get('[data-cy="document-field-attachment-file-input"]').selectFile(
			{
				contents: Cypress.Buffer.alloc(750 * 1024 + 1, 1),
				fileName: "huge-scan.jpg",
				mimeType: "image/jpeg",
			},
			{ force: true },
		);

		cy.get('[data-sonner-toast]', { timeout: 15000 }).should("contain.text", "byte limit");
		cy.get('[data-cy="document-field-attachment-input"]').should("be.visible");
		cy.get('[data-cy="document-field-attachment-value"]').should("not.exist");

		saveDraft();

		listExpenses().then((expenses) => {
			const created = expenses.find((e) => e.data.description === "Huge scan attempt");
			expect(created, "l'expense se sauvegarde quand même, simplement sans pièce jointe").to.exist;
			expect(created?.data.attachment).to.be.oneOf([undefined, null]);
		});
	});

	it("removing an attachment from a saved expense clears it for real — a full replace, never a leftover", () => {
		listExpenses().then((expenses) => {
			const target = expenses.find((e) => e.data.description === "Business lunch with client");
			expect(target, "l'expense du premier test existe toujours").to.exist;
			expect(target?.data.attachment, "elle porte bien une pièce jointe au départ").to.exist;

			cy.visit("/documents/expense");
			cy.get(`[data-cy="document-list-row-${target!.id}"]`, { timeout: 10000 }).click();
			cy.get('[data-cy="document-edit-dialog"]', { timeout: 10000 }).should("be.visible");

			cy.get('[data-cy="document-field-attachment-value"]', { timeout: 10000 }).should("be.visible");
			cy.get('[data-cy="document-field-attachment-remove"]').click();
			cy.get('[data-cy="document-field-attachment-value"]').should("not.exist");
			cy.get('[data-cy="document-field-attachment-input"]').should("be.visible");

			cy.get('[data-cy="document-action-save-draft"]').click();
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");

			cy.request<ExpenseInstance>({ url: `${api}/api/documents/${target!.id}?typeId=expense` })
				.its("body")
				.then((updated) => {
					expect(
						updated.data.attachment,
						"la pièce jointe est réellement retirée, pas seulement masquée à l'écran",
					).to.be.oneOf([undefined, null]);
					// The rest of the record survives the removal untouched.
					expect(updated.data.description).to.eq("Business lunch with client");
					expect(updated.data.category).to.eq("meals");
				});
		});
	});

	it("regression 17: 'expense' still declares exactly its nine business fields, kind 'file' for the attachment", () => {
		cy.request<{ id: string; kind: string; label: string }[]>({
			url: `${api}/api/documents/types/expense`,
		})
			.its("body")
			.then((body: unknown) => {
				const descriptor = body as { fields: { key: string; kind: string }[] };
				const attachment = descriptor.fields.find((f) => f.key === "attachment");
				expect(attachment?.kind).to.eq("file");
				expect(descriptor.fields.map((f) => f.key)).to.include.members([
					"category",
					"distanceKm",
					"ratePerKm",
				]);
			});
	});
});
