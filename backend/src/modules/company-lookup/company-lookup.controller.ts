import { Controller, Get, HttpException, HttpStatus, Param, Query, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CompanyLookupService } from '@/modules/company-lookup/company-lookup.service';
import {
  CompanyLookupResultDto,
  CountryLookupCapabilityDto,
} from '@/modules/company-lookup/dto/company-lookup.dto';
import { LookupScheme } from '@/modules/company-lookup/types';

const SCHEMES: LookupScheme[] = ['LEGAL_ID', 'VAT'];

// AuthGuard (src/guards/auth.guard.ts) bypasses handlers carrying the 'PUBLIC' key.
// Same reasoning as compliance/nest/required-fields.controller.ts: the capability
// matrix is static reference data the onboarding form needs before a company (and a
// fully settled session) exists, and a transient 401 there redirects the user to
// sign-in. The lookup itself stays authenticated — it spends external API quota.
const Public = () => SetMetadata('PUBLIC', true);

@ApiTags('company-lookup')
@Controller('company-lookup')
export class CompanyLookupController {
  constructor(private readonly companyLookupService: CompanyLookupService) {}

  @Public()
  @Get('capabilities')
  @ApiOperation({
    summary: 'List which registry lookup is available per country',
    description:
      'Returns, for every country the compliance profiles know about, the registry providers that can autofill a company form, whether they are configured on this instance, and what identifier the user must type.',
  })
  @ApiResponse({ status: 200, type: [CountryLookupCapabilityDto] })
  getCapabilities(): CountryLookupCapabilityDto[] {
    return this.companyLookupService.capabilities() as CountryLookupCapabilityDto[];
  }

  @Public()
  @Get('capabilities/:countryCode')
  @ApiOperation({ summary: 'Registry lookup capability for one country' })
  @ApiParam({ name: 'countryCode', description: 'ISO 3166-1 alpha-2 country code' })
  @ApiResponse({ status: 200, type: CountryLookupCapabilityDto })
  getCapability(@Param('countryCode') countryCode: string): CountryLookupCapabilityDto {
    return this.companyLookupService.capability(countryCode) as CountryLookupCapabilityDto;
  }

  @Get()
  @ApiOperation({
    summary: 'Look up a company in its national business register',
    description:
      'Resolves a national registration number (or VAT number) against the country’s official register — SIRENE for France, ARES for Czechia, ANAF for Romania, Companies House for the UK, VIES for the rest of the EU, and so on.',
  })
  @ApiQuery({ name: 'country', description: 'ISO 3166-1 alpha-2 country code' })
  @ApiQuery({ name: 'value', description: 'The identifier as typed by the user' })
  @ApiQuery({
    name: 'scheme',
    required: false,
    enum: SCHEMES,
    description: 'Omit to try the registration number first, then the VAT number',
  })
  @ApiResponse({ status: 200, type: CompanyLookupResultDto })
  async lookup(
    @Query('country') country: string,
    @Query('value') value: string,
    @Query('scheme') scheme?: string,
  ): Promise<CompanyLookupResultDto> {
    if (!country || !value) {
      throw new HttpException('country and value query parameters are required', HttpStatus.BAD_REQUEST);
    }
    if (scheme && !SCHEMES.includes(scheme as LookupScheme)) {
      throw new HttpException(`scheme must be one of ${SCHEMES.join(', ')}`, HttpStatus.BAD_REQUEST);
    }

    return (await this.companyLookupService.lookup({
      countryCode: country,
      value,
      scheme: scheme as LookupScheme | undefined,
    })) as CompanyLookupResultDto;
  }
}
