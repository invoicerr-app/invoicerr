/**
 * Realistic, country-appropriate name/address/article pools the demo seed draws from — company and
 * client NAMES, amounts, quantities and dates vary between resets (issue #533's own requirement), a
 * fixed SEED making a run reproducible for tests. Seeded from real conventions, not `e2e/cypress/
 * fixtures/scenarios.ts` (a different npm project — `backend/` and `e2e/` share no code), but the same
 * spirit: plausible company/city names per country, never placeholder "Test Company 1" strings.
 */
import { Rng, floatBetween, intBetween, pickDistinct, pickOne } from './rng';

export type SupportedCountryCode = 'FR' | 'DE' | 'IT' | 'PL' | 'PT';

export interface CountryMeta {
  countryCode: SupportedCountryCode;
  countryName: string;
  language: string;
  /** The next country in the round-robin — every company's ONE foreign, cross-border client is drawn
   *  from this country's own client pool, so five companies cover all five countries as both seller
   *  and buyer, the same "each country reachable as seller and buyer" spirit
   *  `e2e/cypress/fixtures/scenarios.ts`'s six legs hold, at a fifth of the size for a live demo. */
  foreignClientCountry: SupportedCountryCode;
  cities: { city: string; postalCode: string }[];
  companyNamePool: { base: string; suffix: string }[];
  clientNamePool: { base: string; suffix: string }[];
  contactFirstNames: string[];
  contactLastNames: string[];
  articleNamePool: { name: string; type: 'SERVICE' | 'PRODUCT' }[];
  streetPool: string[];
}

const COUNTRIES: Record<SupportedCountryCode, CountryMeta> = {
  FR: {
    countryCode: 'FR',
    countryName: 'France',
    language: 'fr',
    foreignClientCountry: 'DE',
    cities: [
      { city: 'Paris', postalCode: '75011' },
      { city: 'Lyon', postalCode: '69002' },
      { city: 'Nantes', postalCode: '44000' },
    ],
    companyNamePool: [
      { base: 'Atelier Lumière', suffix: 'SARL' },
      { base: 'Studio Lyon Design', suffix: 'SAS' },
      { base: 'Bureau Vert Conseil', suffix: 'SARL' },
    ],
    clientNamePool: [
      { base: 'Maison Dupont', suffix: 'SAS' },
      { base: 'Nantes Bâtiment', suffix: 'SARL' },
      { base: 'Café des Arts', suffix: 'SASU' },
    ],
    contactFirstNames: ['Camille', 'Julien', 'Sophie', 'Antoine'],
    contactLastNames: ['Moreau', 'Lefèvre', 'Girard', 'Bernard'],
    articleNamePool: [
      { name: 'Consulting day', type: 'SERVICE' },
      { name: 'Website maintenance', type: 'SERVICE' },
      { name: 'Ergonomic office chair', type: 'PRODUCT' },
    ],
    streetPool: ['12 rue des Lilas', '8 avenue Foch', '3 place Bellecour'],
  },
  DE: {
    countryCode: 'DE',
    countryName: 'Germany',
    language: 'de',
    foreignClientCountry: 'IT',
    cities: [
      { city: 'Berlin', postalCode: '10115' },
      { city: 'Munich', postalCode: '80331' },
      { city: 'Hamburg', postalCode: '20095' },
    ],
    companyNamePool: [
      { base: 'Berlin Tech', suffix: 'GmbH' },
      { base: 'Bayern Consulting', suffix: 'GmbH' },
      { base: 'Nordlicht Design', suffix: 'UG' },
    ],
    clientNamePool: [
      { base: 'Hamburg Logistik', suffix: 'GmbH' },
      { base: 'München Software', suffix: 'GmbH & Co. KG' },
      { base: 'Café Sonnenschein', suffix: 'GmbH' },
    ],
    contactFirstNames: ['Lukas', 'Anna', 'Felix', 'Marie'],
    contactLastNames: ['Schneider', 'Fischer', 'Weber', 'Wagner'],
    articleNamePool: [
      { name: 'Beratungstag', type: 'SERVICE' },
      { name: 'Softwarelizenz (jährlich)', type: 'SERVICE' },
      { name: 'Ergonomischer Bürostuhl', type: 'PRODUCT' },
    ],
    streetPool: ['Hauptstraße 12', 'Bahnhofsallee 5', 'Lindenweg 9'],
  },
  IT: {
    countryCode: 'IT',
    countryName: 'Italy',
    language: 'it',
    foreignClientCountry: 'PT',
    cities: [
      { city: 'Milano', postalCode: '20121' },
      { city: 'Torino', postalCode: '10121' },
      { city: 'Bologna', postalCode: '40121' },
    ],
    companyNamePool: [
      { base: 'Milano Servizi', suffix: 'SRL' },
      { base: 'Torino Componenti', suffix: 'SRL' },
      { base: 'Bologna Design Studio', suffix: 'SRLS' },
    ],
    clientNamePool: [
      { base: 'Ristorante Bella Vista', suffix: 'SRL' },
      { base: 'Officina Meccanica Rossi', suffix: 'SRL' },
      { base: 'Boutique Moderna', suffix: 'SRLS' },
    ],
    contactFirstNames: ['Giulia', 'Marco', 'Chiara', 'Luca'],
    contactLastNames: ['Ricci', 'Colombo', 'Bruno', 'Ferrari'],
    articleNamePool: [
      { name: 'Giornata di consulenza', type: 'SERVICE' },
      { name: 'Manutenzione sito web', type: 'SERVICE' },
      { name: 'Sedia da ufficio ergonomica', type: 'PRODUCT' },
    ],
    streetPool: ['Via Roma 14', 'Corso Italia 22', 'Piazza Garibaldi 3'],
  },
  PL: {
    countryCode: 'PL',
    countryName: 'Poland',
    language: 'pl',
    foreignClientCountry: 'FR',
    cities: [
      { city: 'Warszawa', postalCode: '00-624' },
      { city: 'Kraków', postalCode: '30-001' },
      { city: 'Gdańsk', postalCode: '80-001' },
    ],
    companyNamePool: [
      { base: 'Kraków Usługi', suffix: 'Sp. z o.o.' },
      { base: 'Warszawa Consulting', suffix: 'Sp. z o.o.' },
      { base: 'Gdańsk Technologie', suffix: 'Sp. z o.o.' },
    ],
    clientNamePool: [
      { base: 'Restauracja Pod Lipą', suffix: 'Sp. z o.o.' },
      { base: 'Biuro Rachunkowe Nowak', suffix: 'Sp. z o.o.' },
      { base: 'Sklep Meblowy Wisła', suffix: 'S.A.' },
    ],
    contactFirstNames: ['Anna', 'Piotr', 'Katarzyna', 'Tomasz'],
    contactLastNames: ['Kowalski', 'Wiśniewski', 'Wójcik', 'Kamiński'],
    articleNamePool: [
      { name: 'Dzień konsultacji', type: 'SERVICE' },
      { name: 'Utrzymanie strony internetowej', type: 'SERVICE' },
      { name: 'Ergonomiczne krzesło biurowe', type: 'PRODUCT' },
    ],
    streetPool: ['ul. Marszałkowska 1', 'ul. Floriańska 8', 'ul. Długa 22'],
  },
  PT: {
    countryCode: 'PT',
    countryName: 'Portugal',
    language: 'pt',
    foreignClientCountry: 'PL',
    cities: [
      { city: 'Lisboa', postalCode: '1000-001' },
      { city: 'Porto', postalCode: '4000-001' },
      { city: 'Coimbra', postalCode: '3000-001' },
    ],
    companyNamePool: [
      { base: 'Porto Digital', suffix: 'Lda' },
      { base: 'Lisboa Consultoria', suffix: 'Lda' },
      { base: 'Coimbra Estúdio Criativo', suffix: 'Unipessoal Lda' },
    ],
    clientNamePool: [
      { base: 'Restaurante Mar Azul', suffix: 'Lda' },
      { base: 'Oficina Central', suffix: 'Lda' },
      { base: 'Livraria Aveiro', suffix: 'Lda' },
    ],
    contactFirstNames: ['Beatriz', 'Rui', 'Inês', 'Tiago'],
    contactLastNames: ['Silva', 'Costa', 'Pereira', 'Santos'],
    articleNamePool: [
      { name: 'Dia de consultoria', type: 'SERVICE' },
      { name: 'Manutenção de site', type: 'SERVICE' },
      { name: 'Cadeira de escritório ergonómica', type: 'PRODUCT' },
    ],
    streetPool: ['Rua das Flores 12', 'Avenida da Liberdade 45', 'Rua do Comércio 3'],
  },
};

export function countryMeta(code: SupportedCountryCode): CountryMeta {
  const meta = COUNTRIES[code];
  if (!meta) throw new Error(`No demo data pool for country "${code}"`);
  return meta;
}

export function pickCity(rng: Rng, meta: CountryMeta) {
  return pickOne(rng, meta.cities);
}

export function pickCompanyName(rng: Rng, meta: CountryMeta): string {
  const { base, suffix } = pickOne(rng, meta.companyNamePool);
  return `${base} ${suffix}`;
}

export function pickClientNames(rng: Rng, meta: CountryMeta, count: number): string[] {
  return pickDistinct(rng, meta.clientNamePool, count).map(({ base, suffix }) => `${base} ${suffix}`);
}

export function pickContactName(rng: Rng, meta: CountryMeta): { firstname: string; lastname: string } {
  return {
    firstname: pickOne(rng, meta.contactFirstNames),
    lastname: pickOne(rng, meta.contactLastNames),
  };
}

export function pickArticles(rng: Rng, meta: CountryMeta, count: number) {
  return pickDistinct(rng, meta.articleNamePool, count).map((article) => ({
    ...article,
    unitPrice: floatBetween(rng, 35, 950, 2),
  }));
}

export function pickStreet(rng: Rng, meta: CountryMeta): string {
  return pickOne(rng, meta.streetPool);
}

export function randomLineQuantity(rng: Rng): number {
  return intBetween(rng, 1, 6);
}

export const SUPPORTED_COUNTRY_CODES: SupportedCountryCode[] = ['FR', 'DE', 'IT', 'PL', 'PT'];
