/**
 * L'Italie et le Mexique, aussi loin que leur canal le permet — et l'endroit exact où ça s'arrête.
 *
 * J'avais rangé ces deux pays dans « bloqués sur des identifiants » et je m'étais arrêté là.
 * C'était trop large : SEULE la jambe CORRECTION dépend du canal, parce qu'une correction est un
 * document qui référence un document que l'autre partie détient — il faut donc qu'il soit parti.
 * Le devis → facture et le paiement, eux, ne dépendent d'aucune transmission, et rien ne les
 * prouvait pour ces deux pays.
 *
 * Ce fichier les prouve, avec le MÊME code que la France et les États-Unis, et il nomme la
 * frontière : jusqu'où on va, et pourquoi on s'arrête là.
 */

import {
	expectQuoteSigned,
	getInvoice,
	invoiceFromQuote,
	issuedInvoiceOnly,
	type JourneyCountry,
	payThroughTheScreen,
	signThroughTheScreen,
} from "../support/journey";
import { api, setupCountry } from "../support/showcase";

const IT: JourneyCountry = {
	label: "Parcours IT",
	name: "Italy",
	iso: "IT",
	identifiers: [
		{ scheme: "LEGAL_ID", value: "12345678901" },
		{ scheme: "VAT", value: "IT12345678901" },
	],
	clientSlug: "it-client",
	vatRate: 22,
};

const MX: JourneyCountry = {
	label: "Parcours MX",
	name: "Mexico",
	iso: "MX",
	identifiers: [
		{ scheme: "RFC", value: "XAXX010101000" },
		{ scheme: "MX_DOMICILIO_FISCAL", value: "01000" },
		{ scheme: "MX_REGIMEN_FISCAL", value: "601" },
	],
	clientSlug: "mx-client",
	vatRate: 16,
};

type Settlement = {
	totalMinor: number;
	paidMinor: number;
	outstandingMinor: number;
	settled: boolean;
};

const settlementOf = (id: string) =>
	cy
		.request<Settlement>({ url: `${api}/api/invoices/${id}/settlement` })
		.its("body");

/** Un devis dans le pays donné — fixture, c'est la situation et non le comportement testé. */
const aQuoteIn = (c: JourneyCountry) =>
	setupCountry(c.label, c.name, c.iso, c.identifiers).then((ids) =>
		cy
			.request<{ id: string; items: { id: string }[] }>({
				method: "POST",
				url: `${api}/api/quotes`,
				body: {
					clientId: ids.clientId,
					title: `Prestation ${c.iso}`,
					currency: "EUR",
					notes: "",
					discountRate: 0,
					items: [
						{
							name: "Conseil",
							description: "",
							quantity: 2,
							unitPrice: 500,
							vatRate: c.vatRate,
							type: "SERVICE",
							order: 0,
						},
					],
				},
			})
			.then((res) => {
				expect(res.status, `devis ${c.iso} créé`).to.be.oneOf([200, 201]);
				return cy.wrap(res.body);
			}),
	);

describe("Italie et Mexique — le parcours jusqu'à la frontière du canal", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	for (const c of [IT, MX]) {
		it(`${c.iso} — devis signé puis facturé, par l'écran, avec le même code que la France`, () => {
			// La signature passe par le courrier du client et la conversion par le dialogue de
			// facturation partielle. Rien là-dedans ne touche un canal de transmission.
			aQuoteIn(c).then((quote) => {
				signThroughTheScreen(quote.id).then(() => {
					expectQuoteSigned(quote.id);

					cy.visit("/quotes");
					cy.get(`[data-cy="create-invoice-${quote.id}"]`, {
						timeout: 20000,
					}).click();
					cy.get(`[data-cy="quote-invoice-quantity-${quote.items[0].id}"]`, {
						timeout: 15000,
					})
						.clear()
						.type("2");
					cy.get('[data-cy="quote-invoice-create-submit"]')
						.should("be.enabled")
						.click();

					invoiceFromQuote(quote.id).then((born) => {
						expect(born.status, "elle naît brouillon, comme partout").to.eq(
							"DRAFT",
						);
					});
				});
			});
		});

		it(`${c.iso} — une facture émise se paie et se solde, sans qu'aucun canal n'intervienne`, () => {
			// Un paiement est de l'argent qui arrive : il ne dépend ni de SdI ni d'un PAC. Que ce
			// test passe montre que « bloqué sur des identifiants » ne valait QUE pour la correction.
			issuedInvoiceOnly(c).then((id) => {
				const invoiceId = id as unknown as string;
				getInvoice(invoiceId).then((inv) => {
					settlementOf(invoiceId).then((before) => {
						expect(before.paidMinor, "rien de payé au départ").to.eq(0);

						payThroughTheScreen(inv.rawNumber as string, inv.totalTTC);

						settlementOf(invoiceId).then((after) => {
							expect(after.paidMinor, "l'encaissement est enregistré").to.eq(
								before.totalMinor,
							);
							expect(after.outstandingMinor, "plus rien de dû").to.eq(0);
							expect(after.settled).to.eq(true);
						});
					});
				});
			});
		});

		it(`${c.iso} — et la correction, ELLE, n'est pas offerte : le document n'est jamais parti`, () => {
			// La frontière, nommée. Une correction référence un document que l'autre partie détient ;
			// tant que la transmission n'a pas abouti, il n'y a rien à corriger. Ce test tombera le
			// jour où les identifiants existeront — et ce sera le signal d'écrire la suite.
			issuedInvoiceOnly(c).then((id) => {
				cy.request({ url: `${api}/api/invoices/${id}/available-actions` })
					.its("body")
					.then(
						(a: {
							complianceStatus: string | null;
							actions: Record<string, boolean>;
						}) => {
							expect(
								a.actions.correct,
								`${c.iso} n'offre pas la correction à ${a.complianceStatus}`,
							).to.eq(false);
						},
					);
				cy.visit("/invoices");
				cy.get(`[data-cy="invoice-row"][data-invoice-id="${id}"]`, {
					timeout: 20000,
				})
					.find('[data-cy="invoice-correct-button"]')
					.should("not.exist");
			});
		});
	}
});
