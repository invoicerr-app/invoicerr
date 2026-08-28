import { Controller, Get, HttpException, HttpStatus, Logger, Query, SetMetadata } from '@nestjs/common';
import { documentKindsFor } from '../profiles/document-kinds';
import { defaultRegistry } from '../profiles/registry';
import { DocumentKindRule, IdentifierRequirement } from '../profiles/schema';

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
  /**
   * Which document kinds this country's businesses use, and what each one is.
   *
   * Sits beside `required-fields` and for the same reason: it is static reference data derived from
   * the country registry, it reads nothing from the session, and the interface needs it to decide
   * what to OFFER — which is a country question the frontend must not answer for itself. Without
   * it, "hide pro formas" or "show credit notes" would end up as a country name in a React
   * component, which is the one thing this architecture forbids.
   *
   * Resolved at a date because everything in a profile is temporal: a country that changes its
   * correction model changes which correction document exists, and that is exactly what Poland did
   * in 2026.
   */
  @Public()
  @Get('document-kinds')
  getDocumentKinds(
    @Query('countryCode') countryCode: string,
    @Query('at') at?: string,
  ): DocumentKindRule[] {
    if (!countryCode) {
      throw new HttpException('countryCode query parameter is required', HttpStatus.BAD_REQUEST);
    }
    const when = at ? new Date(at) : new Date();
    if (Number.isNaN(when.getTime())) {
      throw new HttpException('at must be a valid date', HttpStatus.BAD_REQUEST);
    }
    const { profile } = defaultRegistry.resolve(countryCode);
    return documentKindsFor(profile, when);
  }

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
