import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@thallesp/nestjs-better-auth';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';

import { SsoService } from './sso.service';

/**
 * The one anonymous SSO route: "which identity provider does this email address belong to?"
 *
 * Its own controller, deliberately separate from `sso.controller.ts`, because everything about it is
 * the opposite of that one: no session, no active company, its own rate limit, and a response shape
 * narrowed to two strings. Keeping them apart means a future route added to the company-scoped
 * controller cannot accidentally inherit `@Public()`.
 *
 * Rate limited to 10/minute per IP, far tighter than the instance-wide default of 120
 * (`app.module.ts`'s `ThrottlerModule.forRoot`), the same way `PublicSignaturesController` narrows its
 * own anonymous routes. This endpoint takes an email address and answers a question about it, so an
 * unthrottled version would be a directory-probing oracle — and `main.ts`'s `trust proxy: 1` is what
 * makes the per-IP bucket real rather than one shared instance-wide bucket.
 *
 * The response carries ONLY `providerId` and `label` — see `sso-policy.ts#SsoLookupResult`. No company
 * id, no company name, no endpoint, no echo of the claimed domain list.
 */
@ApiTags('auth')
@Controller('sso')
export class SsoLookupController {
  constructor(private readonly sso: SsoService) {}

  @Get('lookup')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Find the SSO provider for an email address',
    description:
      'Public, rate-limited. Returns { providerId, label } when the address belongs to a company ' +
      'whose SSO is active AND whose email domains have been verified; 204 otherwise. Never reveals ' +
      'anything else about the company.',
  })
  @ApiQuery({ name: 'email', required: true, type: String, example: 'alice@acme.com' })
  @ApiResponse({ status: 200, description: 'The provider to sign in with' })
  @ApiResponse({ status: 204, description: 'No SSO provider for this address' })
  async lookup(@Query('email') email: string, @Res({ passthrough: true }) res: Response) {
    const match = email ? await this.sso.lookupByEmail(email) : null;

    if (!match) {
      // 204, with no body: "no provider" and "malformed address" are deliberately indistinguishable,
      // so the endpoint cannot be used to tell a claimed domain from an unclaimed one.
      res.status(204);
      return;
    }

    return match;
  }
}
