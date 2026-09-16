export {}; // makes this spec a module, not a global script -- see tsconfig.json

/**
 * PDP RECEPTION — inbound e-invoices, France's obligation since 2026-09-01 (CGI art. 289 bis, I —
 * see `received-invoice.descriptor.ts`'s own "receive" country-policy note for the exact wording).
 * Proven THROUGH THE SCREEN, like 36-received-invoices.cy.ts: the channel is connected via
 * `/settings/channels` (same screen, same selectors, as 31-national-channels.cy.ts's own PDP wave),
 * the reception SWEEP is REAL production code (`PdpReceptionSweepRunner`, triggered on demand as a
 * REAL BullMQ job rather than waiting on its own 5-minute default interval — see
 * `cypress.config.ts`'s own `triggerPdpReceptionSweep` header), and "approve"/"reject (motif)"/
 * "record-payment" are all real clicks through the received-invoices list.
 *
 * The ONE thing this spec cannot be: a real network call to superpdp.tech (the real round-trip is
 * `backend/src/modules/documents/transports/pdp/pdp-reception.live.spec.ts`, `PDP_LIVE=1`, which
 * proved this EXACT flow — self-addressed deposit, `direction=in`, download, extract, approve,
 * record-payment — for real, 2026-09-16). Here the backend's own PDP client talks to a REAL local
 * `node:http` server (`cypress.config.ts`'s `startFakePdpServer`) shaped exactly like the sandbox
 * (same three endpoints, same JSON/bytes shapes) — a genuine server-to-server HTTP round-trip the
 * backend cannot tell apart from the real one, never a `cy.intercept` (which only sees browser
 * traffic) and never a stubbed backend module.
 *
 * Fixtures reused VERBATIM from `36-received-invoices.cy.ts` (never hand-written XML/PDF — see that
 * file's own header for how each was generated):
 *  - `supplier-invoice-cii.xml`: "Fixture Fournisseur SARL", net 750.00 / VAT 150.00 / gross 900.00,
 *    one line that sums exactly — used for the "approve then fully record-payment" leg.
 *  - `supplier-invoice-facturx.pdf`: a second, independent real Factur-X — used for the "reject with
 *    a reason" leg, so the two legs never fight over the same `pdpInboundId`/document.
 */
const api = Cypress.env("apiUrl") || "http://localhost:4000";

const CII_FIXTURE_RELATIVE = "received-invoices/supplier-invoice-cii.xml";
const FACTURX_FIXTURE_RELATIVE = "received-invoices/supplier-invoice-facturx.pdf";

const APPROVE_LEG_ID = 900001;
const REJECT_LEG_ID = 900002;

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

/** Polls (never a single read — the sweep runs as a REAL async BullMQ job, see this file's own
 *  header) until a `received-invoice` carrying `data.pdpInboundId === pdpInboundId` shows up — the
 *  same "real poll loop, ~10s budget" shape `waitForDocumentStatus` (support/commands.ts) already
 *  holds for the identical "an async worker will eventually land this" problem. */
function waitForPdpImport(pdpInboundId: number, attemptsLeft = 20): Cypress.Chainable<ReceivedInvoiceInstance> {
	return listReceivedInvoices().then((instances) => {
		const found = instances.find((i) => i.data.pdpInboundId === String(pdpInboundId));
		if (found) return cy.wrap(found);
		if (attemptsLeft <= 0) {
			throw new Error(`No received-invoice ever carried pdpInboundId ${pdpInboundId} — sweep import failed.`);
		}
		cy.wait(500);
		return waitForPdpImport(pdpInboundId, attemptsLeft - 1);
	});
}

describe("Received invoices — inbound via the PDP channel (list + approve/reject from the screen)", () => {
	let fakePdpUrl: string;

	before(() => {
		cy.resetAndSeed();
		cy.task("resetFakePdpServer");
		cy.task("startFakePdpServer").then((rawUrl) => {
			fakePdpUrl = rawUrl as string;
		});
	});

	beforeEach(() => {
		cy.login();
	});

	it('connects the PDP channel via the screen, pointed at the fake sandbox — status "Connected"', () => {
		cy.visit("/settings/channels");
		cy.get('[data-cy="channel-pdp"]', { timeout: 15000 }).should("exist");
		cy.get('[data-cy="channel-pdp-status"]').should("contain.text", "Not connected");

		cy.get('[data-cy="channel-pdp-baseurl-input"]')
			.clear()
			.type(fakePdpUrl);
		cy.get('[data-cy="channel-pdp-clientid-input"]').clear().type("e2e-fake-client-id");
		cy.get('[data-cy="channel-pdp-clientsecret-input"]').clear().type("e2e-fake-client-secret");
		cy.get('[data-cy="channel-pdp-connect-button"]').click();

		cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Channel connected");
		cy.get('[data-cy="channel-pdp-status"]', { timeout: 10000 }).should("contain.text", "Connected");
	});

	it("an empty PDP inbox: the real sweep runs and imports nothing", () => {
		cy.task("setFakePdpInbox", []);
		cy.task("triggerPdpReceptionSweep");
		// An empty `listReceivedInvoices()` result alone cannot distinguish "the sweep ran and
		// genuinely found nothing" from "the sweep never started at all" — both look identical. Poll
		// the fake PDP server's own request counter instead: it only increments on a REAL hit to the
		// "list inbound invoices" endpoint, so a nonzero count is proof `PdpReceptionSweepRunner`
		// actually reached the network, not merely that no row got written. Same bounded-poll shape
		// `waitForPdpImport` below already holds for the identical "an async worker will eventually do
		// X" problem.
		function pollForSweepToRun(attemptsLeft: number): Cypress.Chainable<number> {
			return cy.task<number>("getFakePdpListCallCount").then((count) => {
				if (count > 0 || attemptsLeft <= 0) return cy.wrap(count);
				cy.wait(200);
				return pollForSweepToRun(attemptsLeft - 1);
			});
		}
		pollForSweepToRun(20).then((count) => {
			expect(count, "the real sweep actually called the fake PDP's list endpoint — not just a no-op").to.be.greaterThan(
				0,
			);
		});
		listReceivedInvoices().should("have.length", 0);
	});

	it("a REAL inbound deposit appears on the received-invoices LIST after the sweep runs, with the real extracted fields", () => {
		cy.task("setFakePdpInbox", [
			{
				id: APPROVE_LEG_ID,
				createdAt: new Date().toISOString(),
				fixturePath: CII_FIXTURE_RELATIVE,
				contentType: "application/xml",
			},
		]);
		cy.task("triggerPdpReceptionSweep");

		waitForPdpImport(APPROVE_LEG_ID).then((created) => {
			expect(created.status, "reçue par défaut, jamais 'draft'").to.eq("received");
			expect(created.data.supplier).to.eq("Fixture Fournisseur SARL");
			expect(created.data.grossAmount).to.eq(900);
			expect(created.data.pdpProviderId).to.eq("pdp");
			expect(created.data.fileRef, "le fichier téléchargé est attaché comme pour un dépôt manuel").to.be.a(
				"string",
			);

			// THE SCREEN — the list shows it, no upload dialog ever opened for this one.
			cy.visit("/documents/received-invoice");
			cy.get('[data-cy="document-list-cards"]', { timeout: 15000 })
				.contains("Fixture Fournisseur SARL")
				.closest('[data-cy^="document-list-row-"]')
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Received");
		});

		// The automatic "reçue / prise en charge" push-back (fr:202 is the platform's own, never
		// pushed by us — see pdp-reception.ts's own header; fr:203 IS pushed, automatically, the
		// instant this codebase finished importing the deposit).
		cy.task("getFakePdpLifecycleEvents").then((events) => {
			const pushed = events as Array<{ invoiceId: string; code: string }>;
			expect(pushed.some((e) => e.invoiceId === String(APPROVE_LEG_ID) && e.code === "fr:203")).to.eq(true);
		});
	});

	it('approving the imported deposit from the LIST → "Approved", then a full record-payment marks it settled and pushes PDP\'s "paid" status', () => {
		listReceivedInvoices().then((instances) => {
			const target = instances.find((i) => i.data.pdpInboundId === String(APPROVE_LEG_ID));
			expect(target, "le document importé par le sweep précédent existe toujours").to.exist;
			const id = target!.id;

			cy.visit("/documents/received-invoice");
			cy.runDocumentRowAction(id, "approve");
			// `received-invoice-actions.ts#registry.register('received-invoice', 'approve', ...)` returns
			// `message: 'Approved.'`, echoed VERBATIM by the toast (`use-document-action-runner.ts`'s own
			// `toast.success(result.message ?? ...)`) — a bare `.should("exist")` would stay green for
			// ANY toast, including an error one fired by an unrelated, still-in-flight request.
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "Approved.");
			cy.get(`[data-cy="document-list-row-${id}"]`)
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Approved");

			cy.request<ReceivedInvoiceInstance>({ url: `${api}/api/documents/${id}?typeId=received-invoice` })
				.its("body")
				.its("status")
				.should("eq", "approved");

			// "record-payment" — only offered once approved (received-invoice.descriptor.ts). Same
			// generic params dialog every OTHER parameterized action already uses
			// (24-document-payments.cy.ts's own "record-payment" for the invoice type).
			cy.runDocumentRowAction(id, "record-payment");
			cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
			const dialog = () => cy.get('[data-cy="document-action-params-dialog"]');
			dialog().find('[data-cy="document-field-amount-input"]').clear({ force: true }).type("900", { force: true });
			cy.get('[data-cy="document-action-params-confirm"]').click();
			cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");
			cy.get('[data-sonner-toast]', { timeout: 10000 }).should("contain.text", "settled");

			cy.request({ url: `${api}/api/documents/${id}/settlement?typeId=received-invoice` })
				.its("body")
				.then((body: { settlement: { settled: boolean; outstandingMinor: number } }) => {
					expect(body.settlement.settled, "900 payés sur 900 dus — réglé").to.eq(true);
					expect(body.settlement.outstandingMinor).to.eq(0);
				});

			cy.task("getFakePdpLifecycleEvents").then((events) => {
				const pushed = events as Array<{ invoiceId: string; code: string }>;
				expect(
					pushed.some((e) => e.invoiceId === String(APPROVE_LEG_ID) && e.code === "fr:205"),
					"le statut « approuvée » (fr:205) a été renvoyé à la PDP",
				).to.eq(true);
				expect(
					pushed.some((e) => e.invoiceId === String(APPROVE_LEG_ID) && e.code === "fr:211"),
					"le statut « payée » (fr:211) a été renvoyé à la PDP une fois le règlement complet",
				).to.eq(true);
			});
		});
	});

	it("a SECOND real inbound deposit, rejected from the screen WITH a reason, moves to 'Rejected' and pushes PDP's refusal status", () => {
		cy.task("setFakePdpInbox", [
			{
				id: APPROVE_LEG_ID, // still present in the fake inbox — already imported, must be SKIPPED
				createdAt: new Date().toISOString(),
				fixturePath: CII_FIXTURE_RELATIVE,
				contentType: "application/xml",
			},
			{
				id: REJECT_LEG_ID,
				createdAt: new Date().toISOString(),
				fixturePath: FACTURX_FIXTURE_RELATIVE,
				contentType: "application/pdf",
			},
		]);
		cy.task("triggerPdpReceptionSweep");

		waitForPdpImport(REJECT_LEG_ID).then((created) => {
			expect(created.data.supplier).to.eq("Fixture Fournisseur SARL"); // same fixture family, same seller name

			// Dedup proof, in passing: the FIRST leg's own id must still resolve to exactly ONE
			// received-invoice — re-listing an already-known deposit alongside a new one must never
			// duplicate it (conformity-sweep's own "dedup by pdpInboundId" — reception-sweep-runner.ts).
			listReceivedInvoices().then((instances) => {
				const dupes = instances.filter((i) => i.data.pdpInboundId === String(APPROVE_LEG_ID));
				expect(dupes, "un seul document pour le premier dépôt, jamais un doublon").to.have.length(1);
			});

			cy.visit("/documents/received-invoice");
			cy.runDocumentRowAction(created.id, "reject");
			// "reject" now declares a REQUIRED `reason` param — the SAME generic params dialog opens,
			// never a bare confirm click (the DGFiP buyer-refusal status is "obligatoirement motivé" —
			// see received-invoice.descriptor.ts's own REJECT_PARAMS header).
			cy.get('[data-cy="document-action-params-dialog"]', { timeout: 10000 }).should("be.visible");
			// The Radix dialog's own open animation AND focus-trap (which auto-focuses an element the
			// instant it mounts, then again once its own transition settles) can otherwise still be
			// stealing focus when typing starts, dropping the FIRST few keystrokes (found running this
			// exact spec: "Facture non ..." arrived as "on ..." and, after adding the `.click()` below
			// alone, still as "ture non ..." — a fixed settle wait, not just a click, is what a Radix
			// dialog's own animation frame needs here; `selectCountry` (support/commands.ts) already
			// holds the identical `cy.wait(500)` after opening a Radix layer for the same reason).
			cy.wait(500);
			cy.get('[data-cy="document-action-params-dialog"]')
				.find('[data-cy="document-field-reason-input"]')
				.click()
				.type("Facture non conforme au bon de commande");
			cy.get('[data-cy="document-action-params-confirm"]').click();
			cy.get('[data-cy="document-action-params-dialog"]').should("not.exist");

			cy.get(`[data-cy="document-list-row-${created.id}"]`, { timeout: 10000 })
				.find('[data-cy="document-status-badge"]')
				.should("contain.text", "Rejected");

			cy.request<ReceivedInvoiceInstance>({
				url: `${api}/api/documents/${created.id}?typeId=received-invoice`,
			})
				.its("body")
				.then((updated) => {
					expect(updated.status).to.eq("rejected");
					expect(updated.data.rejectionReason).to.eq("Facture non conforme au bon de commande");
				});

			cy.task("getFakePdpLifecycleEvents").then((events) => {
				const pushed = events as Array<{ invoiceId: string; code: string }>;
				expect(
					pushed.some((e) => e.invoiceId === String(REJECT_LEG_ID) && e.code === "fr:206"),
					"le statut « refusée » (fr:206) a été renvoyé à la PDP",
				).to.eq(true);
			});
		});
	});
});
