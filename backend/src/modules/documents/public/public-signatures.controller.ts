/**
 * The PUBLIC half of the signature flow (see schema.prisma's own `Signature` model header) —
 * three `@Public()` routes (`@thallesp/nestjs-better-auth`'s own decorator, NOT
 * `@/decorators/public.decorator.ts` — see `public-documents.controller.ts`'s own header for why that
 * one is dead code) an anonymous client hits from the `/signature/:token` page: resolve the token,
 * ask for a code, submit it. `@ActiveCompany()` is NEVER used here — there is no session, no company,
 * only a 256-bit token (`signatures/signature-token.ts`) resolved by its hash.
 *
 * Every method delegates straight to `SignaturesService` — this file owns NO business logic beyond
 * "which HTTP verb/path maps to which service method" and the `@nestjs/throttler` rate limits below.
 * That per-route throttle is DEFENSE IN DEPTH, never the actual bound on brute force: the real
 * guarantee is `SignaturesService`'s own lifetime `otpFailedAttempts` counter
 * (`signatures/otp.ts#MAX_FAILED_ATTEMPTS`), which caps an attacker at 5 guesses against a 10^8 code
 * space NO MATTER how many IPs they spread requests across — a per-IP rate limit alone could never
 * make that claim. `sign` (10/min/IP) and `otp` (3/min/IP) get tighter figures;
 * `resolve` relies on the global default (`app.module.ts`'s own `ThrottlerModule.forRoot`) since it
 * carries no secret-guessing surface at all (a wrong token here is indistinguishable from a right one
 * a moment too late to matter — see `SignaturesService.resolvePublicSignature`'s own header).
 */
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '@thallesp/nestjs-better-auth';

import { PublicSignatureView, SignaturesService } from '../signatures/signatures.service';

@ApiTags('public-signatures')
@Controller('public/signatures')
export class PublicSignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  @Public()
  @Get(':token')
  @ApiOperation({
    summary: 'Resolve a signature request by its raw token — no session required',
    description:
      'Returns the minimal facts the /signature/:token page needs to render (which document type, ' +
      'its display number) — nothing about the client or the document CONTENT. An unknown, locked, ' +
      'or already-signed token answers the exact same 400 as every other route on this controller.',
  })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'Signature request resolved' })
  @ApiResponse({ status: 400, description: 'Unknown, locked, or already-used token' })
  async resolve(@Param('token') token: string): Promise<PublicSignatureView> {
    return this.signaturesService.resolvePublicSignature(token);
  }

  @Public()
  @Post(':token/otp')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Mint and email a fresh OTP for this signature request — no session required',
    description:
      'Capped at 3 mints per signature request, EVER (signatures/otp.ts#MAX_OTP_MINTS) — never a ' +
      'widening of the separate, lifetime `otpFailedAttempts` budget `sign` below is bound by.',
  })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'A verification code was emailed' })
  @ApiResponse({ status: 400, description: 'Unknown/locked/used token, or the resend cap was reached' })
  async requestOtp(@Param('token') token: string): Promise<{ message: string }> {
    return this.signaturesService.requestOtp(token);
  }

  @Public()
  @Post(':token/sign')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify the submitted OTP and, on success, sign the document — no session required',
    description:
      'An unknown token, a locked one, an already-signed one, an expired-or-never-minted OTP, and a ' +
      'wrong OTP code all answer the EXACT SAME 400, with the exact same body — see the header on ' +
      'SignaturesService.verifyAndSign for why that indistinguishability is the point. A wrong code ' +
      'counts against this signature request LIFETIME attempt budget ' +
      '(signatures/otp.ts#MAX_FAILED_ATTEMPTS) regardless of this route own per-IP throttle.',
  })
  @ApiParam({ name: 'token', type: String })
  @ApiResponse({ status: 200, description: 'Document signed' })
  @ApiResponse({ status: 400, description: 'Invalid, expired, locked, or already-used — indistinguishable' })
  async sign(@Param('token') token: string, @Body('code') code: string): Promise<{ message: string }> {
    return this.signaturesService.verifyAndSign(token, code);
  }
}
