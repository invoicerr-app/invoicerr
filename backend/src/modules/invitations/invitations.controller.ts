import { Controller, Get, Post, Delete, Body, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InvitationsService } from './invitations.service';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';
import { Public } from '@thallesp/nestjs-better-auth';
import { createPendingSignupStore, createRedisClientForPendingSignups } from '@/lib/pending-signup-store';

// A second, independent connection to the same Redis-backed store `lib/auth.ts` writes through — not
// a shared singleton, deliberately: this controller runs inside Nest DI (unlike `lib/auth.ts`, which
// runs outside it entirely — see that file's own header), and the two never need to share a live
// client object to agree on the same DATA, only on the same key names (`pending-signup-store.ts`'s
// own `invitationCodeKey`), which they do by construction. Mirrors how `modules/documents/queue/redis.
// config.ts#createIoredisClient` is already called independently by more than one consumer in this
// codebase rather than threaded through as a single shared instance.
const pendingSignupStore = createPendingSignupStore(createRedisClientForPendingSignups());

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get('can-register')
  @Public()
  @ApiOperation({
    summary: 'Check if registration is allowed',
    description: 'Checks whether a given invitation code is valid and allows registration (public).',
  })
  @ApiQuery({ name: 'code', required: false, type: String, description: 'Invitation code to validate' })
  @ApiResponse({ status: 200, description: 'Registration status retrieved' })
  async canRegister(@Query('code') code?: string) {
    return this.invitationsService.canRegister(code);
  }

  @Get('is-first-user')
  @Public()
  // An anonymous scan of this route finds every freshly-deployed, not-yet-claimed self-hosted
  // instance on the internet for free (the next signup on one automatically becomes its admin) — the
  // same class of "reconnaissance oracle" `sso-lookup.controller.ts`'s own rate limit exists for, so
  // this borrows its exact numbers: mass-probing many instances still costs something per attempt,
  // even though the underlying fact (nobody has registered yet) is inherent to the "first user claims
  // the instance" model and not something this route itself introduces (the identical answer is one
  // signup attempt away regardless).
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Check if this is the first user',
    description: 'Returns whether any user has been registered yet (public).',
  })
  @ApiResponse({ status: 200, description: 'First user status retrieved' })
  async isFirstUser() {
    const isFirst = await this.invitationsService.isFirstUser();
    return { isFirstUser: isFirst };
  }

  @Post('validate')
  @Public()
  @ApiOperation({
    summary: 'Validate an invitation code',
    description:
      'Validates an invitation code and email pair, storing the code for the registration flow (public).',
  })
  @ApiResponse({ status: 201, description: 'Invitation code validated' })
  async validateInvitation(@Body() body: { code: string; email: string }) {
    if (!body.code || !body.email) {
      throw new BadRequestException('Code and email are required');
    }

    const result = await this.invitationsService.canRegister(body.code);

    if (!result.allowed) {
      throw new BadRequestException(result.message || 'Invalid invitation code');
    }

    await pendingSignupStore.setPendingInvitationCode(body.email.toLowerCase(), body.code);

    return { valid: true, message: 'Invitation code validated' };
  }

  @Post()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Create an invitation',
    description:
      'Generates a new invitation link/code for inviting a user to the active company with a given role.',
  })
  @ApiResponse({ status: 201, description: 'Invitation created' })
  async createInvitation(
    @User() user: CurrentUser,
    @ActiveCompany() companyId: string,
    @Body() body: { expiresInDays?: number; role?: CompanyRole },
  ) {
    return this.invitationsService.createInvitation(
      user.id,
      companyId,
      body.role || CompanyRole.MEMBER,
      body.expiresInDays,
    );
  }

  @Get()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'List invitations',
    description: 'Returns all pending invitations for the active company.',
  })
  @ApiResponse({ status: 200, description: 'Invitations retrieved' })
  async listInvitations(@ActiveCompany() companyId: string) {
    return this.invitationsService.listInvitations(companyId);
  }

  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Delete an invitation', description: 'Revokes a pending invitation by its ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Invitation ID' })
  @ApiResponse({ status: 200, description: 'Invitation deleted' })
  async deleteInvitation(@Param('id') id: string, @ActiveCompany() companyId: string) {
    return this.invitationsService.deleteInvitation(id, companyId);
  }
}
