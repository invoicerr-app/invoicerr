export type AddressParts = {
  houseNumber: string;
  streetName: string;
};

export function parseAddress(address: string): AddressParts {
  const cleaned = address.trim();

  const prefixed = cleaned.match(/^n[°oº]\.?\s*(\d+\w*(?:-\w+)?)\s+(.*)$/i);
  if (prefixed) {
    return { houseNumber: prefixed[1], streetName: prefixed[2] };
  }

  const range = cleaned.match(/^(\d+\w*)-(\d+\w*)\s+(.*)$/);
  if (range) {
    return { houseNumber: `${range[1]}-${range[2]}`, streetName: range[3] };
  }

  const ordinal = cleaned.match(/^(\d+(?:er|e|ème|º|ª|st|nd|rd|th|ᵉʳ|ᵉ|ⁿᵈ|ʳᵈ|ᵗʰ)?)\s+(.*)$/i);
  if (ordinal) {
    return { houseNumber: ordinal[1], streetName: ordinal[2] };
  }

  const standard = cleaned.match(/^(\d+[a-zA-Z\-]*)\s+(.*)$/);
  if (standard) {
    return { houseNumber: standard[1], streetName: standard[2] };
  }

  const reversed = cleaned.match(/^(.*\D)\s+(\d+[a-zA-Z\-]*)$/);
  if (reversed) {
    return { houseNumber: reversed[2], streetName: reversed[1].trim() };
  }

  throw new Error(`Invalid address format: "${address}"`);
}