import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One geocoded candidate, already reshaped from Photon's GeoJSON `Feature` into the flat fields
 * this app's client/company address forms actually carry (see `photon-client.ts`'s own header for
 * the source shape and `apply-address-suggestion.ts` on the frontend for how each field lands).
 */
export class AddressSuggestionDto {
  @ApiProperty({
    description: 'Full display line for the dropdown, e.g. "12 Rue de la Paix, 75002 Paris, France"',
  })
  label!: string;

  @ApiPropertyOptional({ description: 'Street name, without the house number' })
  street?: string;

  @ApiPropertyOptional()
  houseNumber?: string;

  @ApiPropertyOptional()
  postalCode?: string;

  @ApiPropertyOptional()
  city?: string;

  @ApiPropertyOptional({ description: "Country name, in Photon's own language - informational only" })
  country?: string;

  @ApiPropertyOptional({ description: 'ISO 3166-1 alpha-2 country code, uppercase, as Photon returns it' })
  countryCode?: string;
}

export class AddressAutocompleteSearchResultDto {
  @ApiProperty({ type: [AddressSuggestionDto] })
  suggestions!: AddressSuggestionDto[];
}

export class AddressAutocompleteCapabilityDto {
  @ApiProperty({ description: 'Whether ADDRESS_AUTOCOMPLETE_URL is configured on this instance' })
  enabled!: boolean;
}
