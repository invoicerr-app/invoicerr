import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '@thallesp/nestjs-better-auth';

import { User } from '@/decorators/user.decorator';
import { RequestWithUser } from '@/types/request';
import { CurrentUser } from '@/types/user';

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
      'BillingModule does). Terms of Service, Privacy Policy, Data Processing Agreement, Legal ' +
      'Notice, and Cookies & Acceptable Use, each with its current version, effective date, and raw ' +
      'markdown content. `saasMode` is the one field the frontend actually branches on: whether the ' +
      'sign-up screen must show the acceptance checkbox at all.',
  })
  @ApiResponse({ status: 200, description: 'Documents retrieved' })
  documents() {
    return this.legalService.listDocuments();
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
  @ApiOperation({
    summary: 'Accept one or more legal documents',
    description:
      'Authenticated. Body `{ slugs?: string[] }` — omit it to accept whatever is currently pending ' +
      "(the re-acceptance interstitial's own call); an explicit list is filtered down to the " +
      'documents that actually require acceptance (terms-of-service, privacy-policy). A no-op ' +
      '(`{ accepted: [] }`) outside SaaS mode.',
  })
  @ApiResponse({ status: 201, description: 'Acceptance recorded' })
  accept(
    @User() user: CurrentUser,
    @Body() body: { slugs?: string[] } | undefined,
    @Req() request: RequestWithUser,
  ) {
    return this.legalService.accept(user.id, body?.slugs, {
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
