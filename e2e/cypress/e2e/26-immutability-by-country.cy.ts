/**
 * L'immuabilité — le quatrième axe du but, prouvé pour QUATRE pays et non deux.
 *
 * Les specs 22 et 24 opposaient la France aux États-Unis. L'Italie et le Mexique restaient dehors,
 * parce que leur canal n'a pas d'identifiants ici et que leur document ne part jamais. Mais
 * l'immuabilité ne dépend PAS du canal : elle s'applique dès l'émission. Elle est donc observable
 * chez eux, et c'est le seul des quatre axes qu'on pouvait encore leur prendre sans identifiants.
 *
 * Chaque attente ci-dessous est tirée de ce que le PROFIL déclare (`immutableAfter`), pas d'une
 * règle que ce fichier inventerait :
 *   FR `ISSUE` · IT `CLEARANCE` · MX `CLEARANCE` · US `NEVER`
 *
 * Ce que le test établit du même coup, et qui mérite une décision (voir R-P3-12) : `CLEARANCE` se
 * comporte aujourd'hui exactement comme `ISSUE`. Le service ne distingue que « NEVER » et « tout le
 * reste ». Savoir si une facture italienne émise mais non encore transmise au SdI devrait rester
 * modifiable est une question de DROIT, pas de code — elle n'est pas tranchée ici.
 */

import {
	eventually,
	getInvoice,
	issuedInvoiceOnly,
	type JourneyCountry,
} from "../support/journey";
import { api } from "../support/showcase";

type Case = JourneyCountry & { declared: string; editableAfterIssue: boolean };

const CASES: Case[] = [
	{
		label: "Immuable FR",
		name: "France",
		iso: "FR",
		identifiers: [
			{ scheme: "LEGAL_ID", value: "73282932000074" },
			{ scheme: "VAT", value: "FR44732829320" },
		],
		clientSlug: "fr-client",
		vatRate: 20,
		declared: "ISSUE",
		editableAfterIssue: false,
	},
	{
		label: "Immuable IT",
		name: "Italy",
		iso: "IT",
		identifiers: [
			{ scheme: "LEGAL_ID", value: "12345678901" },
			{ scheme: "VAT", value: "IT12345678901" },
		],
		clientSlug: "it-client",
		vatRate: 22,
		declared: "CLEARANCE",
		editableAfterIssue: false,
	},
	{
		label: "Immuable MX",
		name: "Mexico",
		iso: "MX",
		identifiers: [
			{ scheme: "RFC", value: "XAXX010101000" },
			{ scheme: "MX_DOMICILIO_FISCAL", value: "01000" },
			{ scheme: "MX_REGIMEN_FISCAL", value: "601" },
		],
		clientSlug: "mx-client",
		vatRate: 16,
		declared: "CLEARANCE",
		editableAfterIssue: false,
	},
	{
		label: "Immuable US",
		name: "United States",
		iso: "US",
		identifiers: [],
		clientSlug: "us-client",
		vatRate: 0,
		declared: "NEVER",
		editableAfterIssue: true,
	},
];

describe("Ce que chaque pays fige à l'émission", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	for (const c of CASES) {
		it(`${c.iso} — déclaré ${c.declared}, donc ${c.editableAfterIssue ? "encore modifiable" : "figé"} après émission`, () => {
			issuedInvoiceOnly(c).then((id) => {
				const invoiceId = id as unknown as string;

				// Ce que le plan du pays dit de lui-même, relu sur l'enregistrement — pas déduit.
				cy.request({
					url: `${api}/api/invoices/${invoiceId}/available-actions`,
				})
					.its("body")
					.then(
						(a: {
							immutableAfter?: string;
							actions: Record<string, boolean>;
						}) => {
							expect(
								a.immutableAfter,
								`${c.iso} déclare son point de gel`,
							).to.eq(c.declared);
							expect(
								a.actions.edit,
								"et l'écran suit ce que le plan déclare",
							).to.eq(c.editableAfterIssue);
						},
					);

				getInvoice(invoiceId).then((before) => {
					// L'API, pas seulement l'écran : une règle qu'un client scripté contourne n'est
					// qu'un affichage. Corps VALIDE — seule l'immuabilité peut donc refuser.
					cy.request({
						method: "PATCH",
						url: `${api}/api/invoices/${invoiceId}`,
						// Corps COMPLET, et pas seulement `{id, notes}`. Là où la garde d'immuabilité
						// laisse passer (États-Unis), le handler continue et retombe sur un corps partiel
						// par un 500 au lieu d'un 400 — défaut R-P3-11, mieux caractérisé ici. Envoyer
						// l'objet entier garantit que ce test parle d'immuabilité et de rien d'autre.
						body: {
							id: invoiceId,
							clientId: (before as unknown as { clientId: string }).clientId,
							notes: `tentative ${c.iso}`,
							items: (before.items as unknown as Record<string, unknown>[]).map(
								(i, order) => ({
									name: i.name,
									description: i.description ?? "",
									quantity: i.quantity,
									unitPrice: i.unitPrice,
									vatRate: i.vatRate,
									type: i.type ?? "SERVICE",
									order,
								}),
							),
						},
						failOnStatusCode: false,
					}).then((res) => {
						if (c.editableAfterIssue) {
							expect(
								res.status,
								`${c.iso} accepte — ${JSON.stringify(res.body).slice(0, 150)}`,
							).to.be.oneOf([200, 201]);
						} else {
							expect(
								res.status,
								`${c.iso} refuse — ${JSON.stringify(res.body).slice(0, 150)}`,
							).to.be.within(400, 499);
						}
					});

					// Et le refus n'a rien écrit au passage : un « non » qui modifie quand même serait
					// le pire des deux mondes.
					if (!c.editableAfterIssue) {
						eventually(
							invoiceId,
							(r) =>
								r.items.length === before.items.length &&
								r.status === before.status,
							`la facture ${c.iso} est intacte après le refus`,
						);
					}
				});
			});
		});
	}

	it("les quatre réponses ne sont pas les mêmes — c'est la donnée qui décide, pas une branche", () => {
		// Sans ce test, quatre attentes écrites à la main pourraient toutes décrire un code qui
		// refuse toujours. Il faut qu'au moins un pays réponde autrement que les autres.
		const answers = CASES.map((c) => `${c.iso}:${c.editableAfterIssue}`);
		expect(
			new Set(answers.map((a) => a.split(":")[1])).size,
			"au moins deux réponses distinctes",
		).to.be.gte(2);
	});
});
