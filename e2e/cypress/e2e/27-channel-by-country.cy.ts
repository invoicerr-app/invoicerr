/**
 * Le CANAL — le quatrième axe, prouvé pour l'Italie et le Mexique sans attendre d'identifiants.
 *
 * J'avais rangé cet axe dans « bloqué sur des creds ». C'était confondre deux choses : le
 * ROUND-TRIP réel exige une accréditation SdI et un contrat PAC ; le CHOIX DU CANAL, lui, sort du
 * profil et s'observe tout de suite. Ce que le but demande de montrer — « ce que son profil change
 * réellement … canal » — est donc démontrable aujourd'hui, et ce fichier le démontre.
 *
 * Ce qu'il ne prouve PAS, et qu'il ne faut pas lui faire dire : que le document arrive à
 * destination. La spec 22 mesure déjà l'inverse — l'Italie reste en file, le Mexique est refusé —
 * et ce trajet-là attend toujours des identifiants.
 */
import { api, setupCountry } from "../support/showcase";

type Channel = { type: string; providerId: string; configured?: boolean };

const channelsFor = (
	label: string,
	name: string,
	iso: string,
	ids: { scheme: string; value: string }[],
) =>
	setupCountry(label, name, iso, ids).then((x) =>
		cy
			.request<Channel[]>({
				url: `${api}/api/compliance/channels/companies/${x.companyId}/required-channels`,
			})
			.its("body")
			.then((rows) => rows.map((r) => `${r.type}:${r.providerId}`).sort()),
	);

const FR_IDS = [
	{ scheme: "LEGAL_ID", value: "73282932000074" },
	{ scheme: "VAT", value: "FR44732829320" },
];
const IT_IDS = [
	{ scheme: "LEGAL_ID", value: "12345678901" },
	{ scheme: "VAT", value: "IT12345678901" },
];
const MX_IDS = [
	{ scheme: "RFC", value: "XAXX010101000" },
	{ scheme: "MX_DOMICILIO_FISCAL", value: "01000" },
	{ scheme: "MX_REGIMEN_FISCAL", value: "601" },
];

describe("Quel canal le profil désigne, pays par pays", () => {
	before(() => {
		cy.resetAndSeed();
	});

	beforeEach(() => {
		cy.login();
	});

	it("chaque pays exige SES canaux, et aucune branche ne les nomme", () => {
		const seen: Record<string, string[]> = {};

		channelsFor("Canal FR", "France", "FR", FR_IDS).then((c) => {
			seen.FR = c;
		});
		channelsFor("Canal IT", "Italy", "IT", IT_IDS).then((c) => {
			seen.IT = c;
		});
		channelsFor("Canal MX", "Mexico", "MX", MX_IDS).then((c) => {
			seen.MX = c;
		});
		channelsFor("Canal US", "United States", "US", []).then((c) => {
			seen.US = c;
		});

		cy.then(() => {
			// Chaque pays doit exiger AU MOINS un canal : une liste vide voudrait dire que le profil
			// ne dit rien du transport, et le document partirait par un défaut que personne n'a choisi.
			for (const iso of ["FR", "IT", "MX", "US"]) {
				expect(
					seen[iso],
					`${iso} déclare ses canaux — ${JSON.stringify(seen[iso])}`,
				).to.have.length.greaterThan(0);
			}

			// Le cœur de l'affaire : l'Italie et le Mexique n'exigent PAS ce qu'exige la France. Si une
			// branche métier décidait du transport, ces listes convergeraient vers ce qu'elle suppose.
			expect(
				seen.IT.join(","),
				`Italie ${seen.IT} ≠ France ${seen.FR}`,
			).to.not.eq(seen.FR.join(","));
			expect(
				seen.MX.join(","),
				`Mexique ${seen.MX} ≠ Italie ${seen.IT}`,
			).to.not.eq(seen.IT.join(","));
			expect(
				seen.US.join(","),
				`États-Unis ${seen.US} ≠ Mexique ${seen.MX}`,
			).to.not.eq(seen.MX.join(","));
		});
	});

	it("l'écran des réglages montre à l'utilisateur ce que SON pays réclame", () => {
		// L'axe n'est pas prouvé tant qu'il reste dans une réponse JSON : c'est l'écran qui doit dire
		// à l'entreprise italienne qu'il lui faut un accès SdI. Sans ce test, le back pourrait être
		// juste et la page muette — le défaut exact que ce dépôt a déjà livré trois fois aujourd'hui.
		setupCountry("Réglages IT", "Italy", "IT", IT_IDS).then((x) => {
			cy.request<Channel[]>({
				url: `${api}/api/compliance/channels/companies/${x.companyId}/required-channels`,
			})
				.its("body")
				.then((rows) => {
					expect(
						rows,
						"l'Italie exige au moins un canal",
					).to.have.length.greaterThan(0);

					cy.visit("/settings/channels");
					// Chaque canal que le PROFIL exige doit apparaître à l'écran. On les vérifie tous,
					// pas le premier : c'est la liste entière qui informe l'utilisateur.
					for (const r of rows) {
						cy.get(`[data-cy="required-channel-${r.providerId}"]`, {
							timeout: 20000,
						}).should("exist");
					}
				});
		});
	});

	it("et l'entreprise française ne se voit PAS réclamer le canal italien", () => {
		// Sans ce test, le précédent passerait aussi sur un écran qui afficherait TOUS les canaux du
		// monde à tout le monde. C'est la différence entre « la page n'est pas vide » et « la page
		// dépend du pays ».
		setupCountry("Réglages FR", "France", "FR", FR_IDS).then(() => {
			cy.visit("/settings/channels");
			// On attend qu'AU MOINS un canal français soit rendu avant de conclure sur une absence :
			// sinon on constaterait seulement que la page n'a pas fini de charger.
			cy.get('[data-cy^="required-channel-"]', { timeout: 20000 }).should(
				"exist",
			);
			cy.get('[data-cy="required-channel-sdi"]').should("not.exist");
		});
	});
});
