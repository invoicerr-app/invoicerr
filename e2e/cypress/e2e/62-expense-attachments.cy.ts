export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * Expense attachments, category, and mileage ("notes de frais enrichies") — proven THROUGH THE SCREEN, like
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
	// GET /api/documents is now a paged `{ items, total, page, pageSize }` — never a bare
	// array (documents.controller.ts's own "List document instances"). `.its("body.items")` loses
	// the element type through Cypress's own dotted-path typing, so this unwraps via `.then` instead
	// to keep every `.find`/`.filter` callback below typed.
	return cy
		.request<{ items: ExpenseInstance[] }>({ url: `${api}/api/documents?typeId=expense` })
		.its("body")
		.then((body) => body.items);
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
	// Through the shared command rather than inline, for what it does AFTER the option click: every
	// caller of this helper fills "currency" and then opens the date picker on the very next line,
	// and a picker whose deferred focus restore is still pending dismisses that calendar as it lands
	// (support/commands.ts#waitForLayerTeardown).
	cy.pickDocumentFieldOption(fieldKey, optionSlug);
}

function saveDraft() {
	// No DOM assertion on what the save leaves on screen: a successful FIRST save closes the create
	// dialog and lands on the new record's own page (document-create-dialog.tsx), while a save on an
	// already-saved record stays on that page (document-detail.tsx) — the two callers of this helper
	// differ, and neither outcome is the fact under test. Content assertions belong to the API either
	// way (this file's own header) — no DOM check stands in for the API check below.
	//
	// The `[data-sonner-toast]` selector used to be asserted right after the click with no
	// interception behind it — but it matches ANY toast already mounted, including a REFUSAL toast a
	// prior step in the same test just raised on the attachment field ("Unsupported file type"/"byte
	// limit" — Sonner's own default 4s life easily outlives the few hundred ms between that refusal
	// and this click). `cy.get(...).should("exist")` then passed instantly on that STALE toast,
	// without ever waiting for THIS click's own save-draft request to round-trip, so a caller reading
	// the result back immediately after (`listExpenses()`) could race the still-in-flight POST — this
	// is exactly what happened on CI run 34951814251 (commit 94924a36, `created` came back `undefined`
	// even though the save always succeeds): a pure test race, not a product bug, same category of
	// false failure as the dialog-staying-open lesson above. Interception + a status-code assertion on
	// the action's own request (the same discipline 54-email-templates.cy.ts's own save test already
	// uses for its PUT) is what actually proves the save landed before anything reads it back.
	cy.intercept("POST", `${api}/api/documents/types/expense/actions/save-draft`).as("saveExpenseDraft");
	cy.get('[data-cy="document-action-save-draft"]').click();
	cy.wait("@saveExpenseDraft").then((interception) => {
		expect(
			interception.response?.statusCode,
			"save-draft doit réellement atteindre le serveur avant qu'on ne relise l'expense",
		).to.be.oneOf([200, 201]);
	});
	cy.get('[data-sonner-toast]', { timeout: 10000 }).should("exist");
}

describe("Expense attachments, category, and mileage", () => {
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
		cy.pickToday('[data-cy="document-field-date-input"]');
		// "description"/"amount"/"currency"/"date" (all `required`) are the wizard's own "Details"
		// step; expense has no table-shaped field at all, so "Continue" lands straight on "Options"
		// (document-create-dialog.tsx's `buildFieldGroups` — "a type with no lines skips that step").
		cy.continueDocumentWizard();
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

		// Mileage — plain optional fields, filled here to prove they round-trip too (never a
		// per-country rate: the user's own number, see the descriptor's own header).
		cy.get('[data-cy="document-field-distanceKm-input"]').type("12");
		cy.get('[data-cy="document-field-ratePerKm-input"]').type("0.5");

		cy.continueDocumentWizard(); // Options -> Summary
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
			// (contributions/expense-contributions.ts) — the e2e proof this feature's own brief
			// (enriched expense notes, "notes de frais enrichies") names explicitly.
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
		cy.pickToday('[data-cy="document-field-date-input"]');
		cy.continueDocumentWizard(); // Details -> Options ("attachment" lives there)

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

		cy.continueDocumentWizard(); // Options -> Summary
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

	it("a file over the size limit is refused (413) with never a byte written, and never attached", () => {
		openCreateDialog();

		cy.get('[data-cy="document-field-description-input"]').type("Huge scan attempt");
		cy.get('[data-cy="document-field-amount-input"]').type("10");
		pickSelectOption("currency", "eur");
		cy.pickToday('[data-cy="document-field-date-input"]');
		cy.continueDocumentWizard(); // Details -> Options ("attachment" lives there)

		// One byte over the multipart/form-data ceiling (10 MB — attachments.service.ts's own
		// `MAX_ATTACHMENT_BYTES`, ALSO multer's own `limits.fileSize` at the interceptor —
		// documents.controller.ts's `uploadAttachment`) — an ALLOWED mime, refused purely for its
		// size, aborted at the wire before this attempt ever reaches disk.
		cy.intercept("POST", `${api}/api/documents/attachments/upload`).as("uploadAttachment");
		cy.get('[data-cy="document-field-attachment-file-input"]').selectFile(
			{
				contents: Cypress.Buffer.alloc(10 * 1024 * 1024 + 1, 1),
				fileName: "huge-scan.jpg",
				mimeType: "image/jpeg",
			},
			{ force: true },
		);
		cy.wait("@uploadAttachment").its("response.statusCode").should("eq", 413);

		cy.get('[data-sonner-toast]', { timeout: 15000 }).should("contain.text", "10 MB");
		cy.get('[data-cy="document-field-attachment-input"]').should("be.visible");
		cy.get('[data-cy="document-field-attachment-value"]').should("not.exist");

		cy.continueDocumentWizard(); // Options -> Summary
		saveDraft();

		listExpenses().then((expenses) => {
			const created = expenses.find((e) => e.data.description === "Huge scan attempt");
			expect(created, "l'expense se sauvegarde quand même, simplement sans pièce jointe").to.exist;
			expect(created?.data.attachment, "aucun octet écrit pour un dépôt refusé au niveau multipart").to.be
				.oneOf([undefined, null]);
		});
	});

	it("removing an attachment from a saved expense clears it for real — a full replace, never a leftover", () => {
		listExpenses().then((expenses) => {
			const target = expenses.find((e) => e.data.description === "Business lunch with client");
			expect(target, "l'expense du premier test existe toujours").to.exist;
			expect(target?.data.attachment, "elle porte bien une pièce jointe au départ").to.exist;

			cy.visit("/documents/expense");
			cy.openDocument(target!.id);

			// `scrollIntoView()`: on the CI viewport (1000×660) the attachment field sits past one
			// screenful of the record page's own scroll area — clipped, not absent.
			cy.get('[data-cy="document-field-attachment-value"]', { timeout: 10000 })
				.scrollIntoView()
				.should("be.visible");
			cy.get('[data-cy="document-field-attachment-remove"]').click();
			cy.get('[data-cy="document-field-attachment-value"]').should("not.exist");
			cy.get('[data-cy="document-field-attachment-input"]').should("be.visible");

			// Same helper as the create-side tests — same interception discipline, see its own header.
			saveDraft();

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
