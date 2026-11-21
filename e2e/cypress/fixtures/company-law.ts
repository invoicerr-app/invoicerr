interface CompanyLaw {
	legalForm: string;
	values: Record<string, string | { amount: string; currency: string }>;
}

/** Company-law values a seller of each country needs before Validate and Send accept its invoices. */
const COMPANY_LAW: Record<string, CompanyLaw> = {
	FR: {
		legalForm: "FR_SAS",
		values: { shareCapital: { amount: "1000", currency: "EUR" }, registerCity: "Paris" },
	},
	DE: { legalForm: "DE_EINZEL", values: {} },
	IT: { legalForm: "IT_DITTA_INDIVIDUALE", values: {} },
	PL: { legalForm: "PL_JDG", values: {} },
	PT: { legalForm: "PT_ENI", values: {} },
	DZ: { legalForm: "DZ_PERSONNE_PHYSIQUE", values: { activity: "Services informatiques" } },
};

const CODE_BY_NAME: Record<string, string> = {
	France: "FR",
	Germany: "DE",
	Italy: "IT",
	Poland: "PL",
	Portugal: "PT",
	Algeria: "DZ",
};

/** By ISO code or English country name; `undefined` for a country whose catalog asks for nothing. */
export function companyLawFor(country: string): CompanyLaw | undefined {
	return COMPANY_LAW[CODE_BY_NAME[country] ?? country.toUpperCase()];
}
