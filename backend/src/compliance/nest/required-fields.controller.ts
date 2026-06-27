import { Controller, Get, HttpException, HttpStatus, Logger, Query } from '@nestjs/common';
import { defaultRegistry } from '../profiles/registry';
import { IdentifierRequirement } from '../profiles/schema';

@Controller('compliance')
export class RequiredFieldsController {
  private readonly logger = new Logger(RequiredFieldsController.name);

  @Get('required-fields')
  getRequiredFields(
    @Query('countryCode') countryCode: string,
    @Query('partyType') partyType: 'COMPANY' | 'INDIVIDUAL',
  ): IdentifierRequirement[] {
    if (!countryCode) {
      throw new HttpException('countryCode query parameter is required', HttpStatus.BAD_REQUEST);
    }
    if (!partyType || !['COMPANY', 'INDIVIDUAL'].includes(partyType)) {
      throw new HttpException('partyType query parameter must be COMPANY or INDIVIDUAL', HttpStatus.BAD_REQUEST);
    }

    const { profile } = defaultRegistry.resolve(countryCode);
    const all = profile.requiredIdentifiers ?? [];

    return all.filter((req) => req.appliesTo === 'BOTH' || req.appliesTo === partyType);
  }
}
