export interface PartyIdentifier {
    scheme: string;
    value: string;
}

export interface Client {
    id: string;
    name: string;
    description?: string;
    type: string;
    foundedAt?: Date;
    contactFirstname?: string;
    contactLastname?: string;
    contactEmail: string;
    contactPhone?: string;
    address?: string;
    addressLine2?: string;
    postalCode?: string;
    city?: string;
    state?: string;
    country?: string;
    countryCode?: string | null;
    currency?: string; // Assuming currency is a string, e.g., "USD", "EUR"
    isActive?: boolean;
    partyIdentifiers?: PartyIdentifier[];
}
