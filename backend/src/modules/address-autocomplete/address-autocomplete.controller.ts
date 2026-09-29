import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { AddressAutocompleteService } from './address-autocomplete.service';
import {
  AddressAutocompleteCapabilityDto,
  AddressAutocompleteSearchResultDto,
} from './dto/address-suggestion.dto';

/**
 * Both routes require an authenticated session or API key - neither carries `@Public()`, so the
 * global `AuthGuard` (`src/guards/auth.guard.ts`) refuses an anonymous caller before either handler
 * runs, the same protection `company-lookup`/`sirene` already rely on for their own outbound-lookup
 * routes. That keeps this instance's Photon quota (and, for the komoot.io demo server, its shared
 * fair-use budget) spent only by signed-in users of THIS deployment, never an anonymous scraper.
 */
@ApiTags('address-autocomplete')
@Controller('address-autocomplete')
export class AddressAutocompleteController {
  constructor(private readonly addressAutocompleteService: AddressAutocompleteService) {}

  @Get('capability')
  @ApiOperation({
    summary: 'Whether address autocomplete is configured on this instance',
    description:
      'The frontend checks this ONCE before ever firing a suggestion request - empty means the operator never set ADDRESS_AUTOCOMPLETE_URL, and the address fields stay plain text with zero network calls.',
  })
  @ApiResponse({ status: 200, type: AddressAutocompleteCapabilityDto })
  getCapability(): AddressAutocompleteCapabilityDto {
    return this.addressAutocompleteService.capability();
  }

  @Get('search')
  // A tighter override of the global default (120/min, `app.module.ts`'s `ThrottlerModule.forRoot`):
  // this route proxies to a THIRD PARTY under a fair-use policy, not merely this instance's own
  // database, so 120 authenticated requests/minute from one caller is still 120 requests against
  // photon.komoot.io's shared demo server if that's what the operator pointed this at. 30/min is
  // generous for actual typing (debounced ~300ms client-side, so a continuous typist fires at most
  // ~3-4/s in bursts, never sustained) while bounding a scripted caller.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Address suggestions for the given query, proxied through the configured Photon server',
    description:
      'Returns an empty list (never an error) when ADDRESS_AUTOCOMPLETE_URL is unset, the query is under 3 characters, or the configured Photon server is unreachable/slow - the caller degrades to plain typing in every case.',
  })
  @ApiQuery({ name: 'q', description: 'The address text typed so far' })
  @ApiResponse({ status: 200, type: AddressAutocompleteSearchResultDto })
  async search(@Query('q') q: string): Promise<AddressAutocompleteSearchResultDto> {
    const suggestions = await this.addressAutocompleteService.search(q);
    return { suggestions };
  }
}
