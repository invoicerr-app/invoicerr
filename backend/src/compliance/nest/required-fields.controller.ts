import { Controller, Get, HttpException, HttpStatus, Query, SetMetadata } from '@nestjs/common';
import { documentKindsFor } from '../profiles/document-kinds';
import { defaultRegistry } from '../profiles/registry';
import { DocumentKindRule, IdentifierRequirement } from '../profiles/schema';
import { VatRateView, VatRatesService } from '../tax-rates/vat-rates.service';

/**
 * Why the frontend can't just render an empty list and say nothing:
 *  - NOT_A_VAT_SYSTEM: the country has no VAT/GST at all (`taxSystem.kind === 'NONE'`).
 *  - DESTINATION_BASED_SYSTEM: the country's tax (e.g. US sales tax) is set by the BUYER's
 *    state/destination, not a fixed rate of the seller's country — a flat per-country list would
 *    misrepresent how the tax actually works, so none is offered by design, not by omission.
 *  - NO_CATALOG_YET: a genuine VAT/GST country, just not one of the four (FR/IT/PL/MX) this catalog
 *    has sourced rates for yet.
 * Kept as a code, not a message: the label shown to the user must go through the frontend's own
 * i18n `t()`, never a raw string from the backend.
 */
export type VatRatesUnavailableReason = 'NOT_A_VAT_SYSTEM' | 'DESTINATION_BASED_SYSTEM' | 'NO_CATALOG_YET';

export interface VatRatesResponse {
  /** The country code as requested. */
  countryCode: string;
  /** The country code the catalog was actually looked up under, after following profile delegation
   *  (e.g. Monaco resolves to France — COMPLIANCE_ARCHITECTURE.md's Monaco-delegates-to-FR rule). */
  resolvedCountryCode: string;
  taxSystemKind: string;
  rates: VatRateView[];
  unavailableReason?: VatRatesUnavailableReason;
}

// AuthGuard (src/guards/auth.guard.ts) bypasses any handler carrying the
// 'PUBLIC' metadata key. We set it directly here rather than via
// @thallesp/nestjs-better-auth's Public() so this controller doesn't pull
// better-auth's ESM entrypoint into the CommonJS Jest run (it breaks the
// controller's unit spec with "Cannot use import statement outside a module").
const Public = () => SetMetadata('PUBLIC', true);

@Controller('compliance')
export class RequiredFieldsController {
  constructor(private readonly vatRatesService: VatRatesService) {}

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
  getDocumentKinds(@Query('countryCode') countryCode: string, @Query('at') at?: string): DocumentKindRule[] {
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

  /**
   * The VAT rate list for the invoice/quote line-item picker (P?-T?? "a VAT list, not a free
   * number" — see `compliance/tax-rates/schema.ts`). Public and country-code-driven for the exact
   * same reason as its siblings above: the frontend already resolves "the active company's country"
   * itself (it has the company row) and this must stay reachable without a settled session.
   *
   * Never trusts the catalog blindly: it first asks the country's OWN compliance profile what kind
   * of tax system it runs, and only serves a rate list for VAT/GST. Monaco (which delegates to
   * France) resolves through to FR's catalog automatically — no Monaco-specific code here, the
   * delegation already lives in `ProfileRegistry`.
   */
  @Public()
  @Get('vat-rates')
  async getVatRates(
    @Query('countryCode') countryCode: string,
    @Query('at') at?: string,
  ): Promise<VatRatesResponse> {
    if (!countryCode) {
      throw new HttpException('countryCode query parameter is required', HttpStatus.BAD_REQUEST);
    }
    const when = at ? new Date(at) : new Date();
    if (Number.isNaN(when.getTime())) {
      throw new HttpException('at must be a valid date', HttpStatus.BAD_REQUEST);
    }

    const { profile } = defaultRegistry.resolve(countryCode);
    const kind = profile.taxSystem.kind;
    const requested = countryCode.toUpperCase();
    const resolved = profile.countryCode.toUpperCase();

    if (kind !== 'VAT' && kind !== 'GST') {
      return {
        countryCode: requested,
        resolvedCountryCode: resolved,
        taxSystemKind: kind,
        rates: [],
        unavailableReason: kind === 'SALES_TAX' ? 'DESTINATION_BASED_SYSTEM' : 'NOT_A_VAT_SYSTEM',
      };
    }

    const rates = await this.vatRatesService.ratesFor(resolved, when);
    return {
      countryCode: requested,
      resolvedCountryCode: resolved,
      taxSystemKind: kind,
      rates,
      unavailableReason: rates.length === 0 ? 'NO_CATALOG_YET' : undefined,
    };
  }
}
