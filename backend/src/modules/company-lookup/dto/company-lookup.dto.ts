import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LookupScheme } from '../types';

export class CompanyLookupCompanyDto {
  @ApiProperty() name: string;
  @ApiPropertyOptional() legalName?: string;
  @ApiPropertyOptional({ description: 'National registration number (SIRET, IČO, NIP, CVR, CNPJ…)' })
  legalId?: string;
  @ApiPropertyOptional({ description: "The national scheme legalId belongs to, e.g. 'SIRET'" })
  legalIdScheme?: string;
  @ApiPropertyOptional() VAT?: string;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() postalCode?: string;
  @ApiPropertyOptional() city?: string;
  @ApiPropertyOptional() state?: string;
  @ApiPropertyOptional() country?: string;
  @ApiPropertyOptional() countryCode?: string;
  @ApiPropertyOptional() foundedAt?: Date;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'UNKNOWN'] })
  status?: 'ACTIVE' | 'INACTIVE' | 'UNKNOWN';
  @ApiPropertyOptional({ nullable: true }) vatRegistered?: boolean | null;
}

export class CompanyLookupResultDto {
  @ApiProperty() found: boolean;
  @ApiProperty({ type: CompanyLookupCompanyDto, nullable: true })
  company: CompanyLookupCompanyDto | null;
  @ApiPropertyOptional({ description: 'Provider id that answered, e.g. fr-recherche-entreprises' })
  source?: string;
  @ApiPropertyOptional({ description: "Contributing providers, joined — e.g. 'VIES + GLEIF'" })
  sourceLabel?: string;
  @ApiPropertyOptional({ isArray: true, type: String })
  sources?: string[];
  @ApiPropertyOptional({
    enum: ['UNSUPPORTED_COUNTRY', 'NOT_CONFIGURED', 'INVALID_IDENTIFIER', 'PROVIDER_ERROR'],
  })
  error?: string;
  @ApiPropertyOptional() message?: string;
}

export class ProviderCapabilityDto {
  @ApiProperty() id: string;
  @ApiProperty() label: string;
  @ApiProperty({
    enum: ['REGISTER', 'PARTIAL'],
    description: 'REGISTER = the official register · PARTIAL = a worldwide directory (LEI, Peppol)',
  })
  coverage: 'REGISTER' | 'PARTIAL';
  @ApiProperty({ isArray: true, enum: ['LEGAL_ID', 'VAT'] }) schemes: readonly LookupScheme[];
  @ApiProperty() identifierLabel: string;
  @ApiPropertyOptional() docsUrl?: string;
  @ApiProperty() requiresCredentials: boolean;
  @ApiPropertyOptional({ isArray: true, type: String }) credentialEnvVars?: readonly string[];
  @ApiProperty() configured: boolean;
}

export class CountryLookupCapabilityDto {
  @ApiProperty() countryCode: string;
  @ApiProperty({ enum: ['AVAILABLE', 'NEEDS_CREDENTIALS', 'UNAVAILABLE'] })
  status: 'AVAILABLE' | 'NEEDS_CREDENTIALS' | 'UNAVAILABLE';
  @ApiProperty({ enum: ['REGISTER', 'PARTIAL'] })
  coverage: 'REGISTER' | 'PARTIAL';
  @ApiProperty({ type: [ProviderCapabilityDto] }) providers: ProviderCapabilityDto[];
  @ApiProperty({ isArray: true, enum: ['LEGAL_ID', 'VAT'] }) schemes: LookupScheme[];
  @ApiPropertyOptional() identifierLabel?: string;
  @ApiPropertyOptional() note?: string;
}
