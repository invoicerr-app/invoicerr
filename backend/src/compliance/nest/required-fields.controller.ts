import { Controller, Get, HttpException, HttpStatus, Logger, Query, SetMetadata } from '@nestjs/common';
import { defaultRegistry } from '../profiles/registry';
import { IdentifierRequirement } from '../profiles/schema';

// AuthGuard (src/guards/auth.guard.ts) bypasses any handler carrying the
// 'PUBLIC' metadata key. We set it directly here rather than via
// @thallesp/nestjs-better-auth's Public() so this controller doesn't pull
// better-auth's ESM entrypoint into the CommonJS Jest run (it breaks the
// controller's unit spec with "Cannot use import statement outside a module").
const Public = () => SetMetadata('PUBLIC', true);

@Controller('compliance')
export class RequiredFieldsController {
  private readonly logger = new Logger(RequiredFieldsController.name);

  // Static reference data: which identifier schemes a country requires for
  // invoicing compliance. Derived purely from the query params + the built-in
  // country registry — it reads nothing from the session/user/company. It must
  // be reachable during onboarding *before* a company (and therefore a fully
  // settled session) exists; gating it behind AuthGuard meant a transient 401
  // here hard-redirected the user out of the onboarding dialog to /auth/sign-in
  // (frontend authenticatedFetch redirects on any 401). Public + context-free.
  @Public()
  @Get('required-fields')
  getRequiredFields(
    @Query('countryCode') countryCode: string,
    @Query('partyType') partyType: 'COMPANY' | 'INDIVIDUAL',
  ): IdentifierRequirement[] {
    if (!countryCode) {
      throw new HttpException('countryCode query parameter is required', HttpStatus.BAD_REQUEST);
    }
    if (!partyType || !['COMPANY', 'INDIVIDUAL'].includes(partyType)) {
      throw new HttpException(
        'partyType query parameter must be COMPANY or INDIVIDUAL',
        HttpStatus.BAD_REQUEST,
      );
    }

    const { profile } = defaultRegistry.resolve(countryCode);
    const all = profile.requiredIdentifiers ?? [];

    return all.filter((req) => req.appliesTo === 'BOTH' || req.appliesTo === partyType);
  }
}
