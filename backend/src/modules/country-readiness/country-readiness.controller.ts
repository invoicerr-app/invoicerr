import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CountryReadinessService } from './country-readiness.service';

@ApiTags('country-readiness')
@Controller('country-readiness')
export class CountryReadinessController {
  constructor(private readonly countryReadinessService: CountryReadinessService) {}

  // 'fully-supported' is declared before the dynamic ':countryCode' route below so Nest/Express
  // matches the literal segment first — the same static-before-dynamic ordering documents.controller.ts
  // already follows for the same reason (see that file's own header comment).
  @Get('fully-supported')
  @ApiOperation({
    summary: 'Country codes fully supported by the compliance core',
    description:
      'Every country code present in all six core mechanisms (country-policy, vat-rates, ' +
      'tax-systems, correction-routes, country-identifiers, channel-policy) — i.e. every code `GET ' +
      '/country-readiness/:countryCode` would answer `complete: true` for. Optional convenience so ' +
      'the frontend can highlight fully-supported countries; not itself required by any flow. Not ' +
      'scoped by `@ActiveCompany()` — see the sibling endpoint for why.',
  })
  @ApiResponse({ status: 200, description: 'Fully-supported country codes retrieved' })
  listFullySupported() {
    return { countryCodes: this.countryReadinessService.listFullySupportedCountries() };
  }

  // Static, before the dynamic ':countryCode' route below — same ordering discipline as
  // 'fully-supported' above, and for the identical reason.
  @Get('mention-window-alerts')
  @ApiOperation({
    summary: 'Legal mentions whose interpolated value table is about to stop covering new invoices',
    description:
      'One entry per (country, placeholder) whose `documents/mentions/data/*.json` value table has ' +
      'every window bounded (no open-ended entry) and its latest `validTo` within 90 days — or ' +
      'already past. Once that date is reached, `mentions/invoice-notes.ts` refuses to build the ' +
      'mention at all (a named 400, never a printed "{token}") for every invoice in that country — ' +
      'this is the advance warning meant to prevent that from ever being a surprise. Not scoped by ' +
      '@ActiveCompany(): this is an operational fact about the catalog itself, not about any one ' +
      "company's data.",
  })
  @ApiResponse({ status: 200, description: 'Mention window alerts computed' })
  getMentionWindowAlerts() {
    return { alerts: this.countryReadinessService.getMentionWindowAlerts() };
  }

  @Get(':countryCode')
  @ApiOperation({
    summary: 'Whether a country has every core compliance mechanism wired',
    description:
      'A country is "complete" when it has a `data/xx.json` file in all six CŒUR mechanisms: ' +
      'country-policy, vat-rates, tax-systems, correction-routes, country-identifiers, ' +
      'channel-policy (`mentions`, `content-requirements`, `b2g-routing`, `country-fields`, ' +
      '`archive/retention` and `reporting` are deliberately excluded, each for its own reason — see ' +
      'country-readiness.service.ts). Used at company creation (onboarding and settings) to warn, ' +
      'never block, when the chosen country is not yet fully supported. Deliberately NOT scoped by ' +
      '@ActiveCompany(): company creation happens BEFORE a company — and therefore an active ' +
      'company — exists, so this only requires the caller to be authenticated (mirrors ' +
      "documents.controller.ts's own 'required-identifiers' endpoint for the same reason).",
  })
  @ApiParam({ name: 'countryCode', type: String, description: 'ISO 3166-1 alpha-2, case-insensitive' })
  @ApiResponse({ status: 200, description: 'Readiness computed' })
  getReadiness(@Param('countryCode') countryCode: string) {
    return this.countryReadinessService.getReadiness(countryCode);
  }
}
