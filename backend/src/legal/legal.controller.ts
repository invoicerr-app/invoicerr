import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@thallesp/nestjs-better-auth';

import { User } from '@/decorators/user.decorator';
import { RequestWithUser } from '@/types/request';
import { CurrentUser } from '@/types/user';

import { AcceptLegalDto, parseAcceptLegalSlugs } from './legal.dto';
import { LegalGateExempt } from './legal-gate-exempt.decorator';
import { resolveLegalDocumentLanguages } from './legal-request-language';
import { LegalService } from './legal.service';

@ApiTags('legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  @Get('documents')
  @Public()
  @ApiOperation({
    summary: 'List the legal documents',
    description:
      'Public, always reachable (even on a self-hosted instance — this route never 404s the way ' +
      'BillingModule does). In SaaS mode: Terms of Service, Privacy Policy, Data Processing ' +
      'Agreement, Legal Notice, Cookies & Acceptable Use, and International Access Transparency, ' +
      'each with its current version, effective date, and raw markdown content resolved into a ' +
      'language (`legal-request-language.ts`): the `lang` query param when given and supported, else ' +
      "the caller's own account locale when signed in, else this request's own `Accept-Language` " +
      'header, else English — resolved separately per document, since not every document ships every ' +
      'language. Outside SaaS mode `documents` is always the empty array: every one of the six ' +
      "describes the hosted offering by name (the author's own identity, a subscription, a processor " +
      "relationship) and none of it is true of a self-hosted operator's instance — only the licence " +
      'in the repository governs that install, and this route has never served it. `saasMode` is the ' +
      'one field the frontend actually branches on: whether the sign-up screen must show the ' +
      'acceptance checkbox, and whether there is anything here worth linking to at all.',
  })
  @ApiQuery({
    name: 'lang',
    required: false,
    type: String,
    description:
      "Explicit language override (e.g. the frontend's own per-document language selector) — " +
      'outranks the account locale and `Accept-Language`. Silently ignored if not one of the ' +
      'languages this catalog carries at all; a document with no translation into it still falls ' +
      'back to English.',
  })
  @ApiResponse({ status: 200, description: 'Documents retrieved' })
  async documents(@Req() request: RequestWithUser, @Query('lang') lang?: string) {
    const preferredLanguages = await resolveLegalDocumentLanguages(request, lang);
    return this.legalService.listDocuments(preferredLanguages);
  }

  @Get('status')
  @ApiOperation({
    summary: "The current user's legal-acceptance status",
    description:
      'Authenticated. Always `{ requiresAcceptance: false, pending: [] }` outside SaaS mode. Drives ' +
      'the sign-in re-acceptance interstitial (`pages/legal/accept.tsx`) whenever a required document ' +
      'has a newer version than what this user last accepted.',
  })
  @ApiResponse({ status: 200, description: 'Status retrieved' })
  status(@User() user: CurrentUser) {
    return this.legalService.getStatus(user.id);
  }

  @Post('accept')
  // `LegalAcceptanceGuard` (registered globally, SaaS mode only — see that file's own header) refuses
  // every write from a caller with a pending acceptance, named `LEGAL_ACCEPTANCE_REQUIRED` — this is
  // the ONE write route that must survive that refusal, since it is the only way to ever clear it.
  @LegalGateExempt()
  @ApiOperation({
    summary: 'Accept one or more legal documents',
    description:
      'Authenticated. Body `{ slugs?: string[] }` — omit it to accept whatever is currently pending ' +
      "(the re-acceptance interstitial's own call); an explicit list is filtered down to the " +
      'documents that actually require acceptance (terms-of-service, privacy-policy). A no-op ' +
      '(`{ accepted: [] }`) outside SaaS mode.',
  })
  @ApiResponse({ status: 201, description: 'Acceptance recorded' })
  @ApiResponse({ status: 400, description: 'slugs was present but not an array of strings' })
  accept(
    @User() user: CurrentUser,
    @Body() body: AcceptLegalDto | undefined,
    @Req() request: RequestWithUser,
  ) {
    return this.legalService.accept(user.id, parseAcceptLegalSlugs(body), {
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
