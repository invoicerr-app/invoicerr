import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { User } from '@/decorators/user.decorator';
import { InstanceOperatorGuard } from '@/guards/instance-operator.guard';
import { CurrentUser } from '@/types/user';

import { InstancePreflightService, InstancePreflightView } from './instance-preflight.service';
import { InstanceResetSaasGuard } from './instance-reset-saas.guard';
import { InstanceResetService } from './instance-reset.service';

interface InstanceResetBody {
  otp: string;
  confirmationWord: string;
}

/**
 * Instance-wide, cross-tenant actions — every route here sits behind TWO stacked guards, never
 * `@Roles()`/`@ActiveCompany()` (there is no per-company scope to this controller at all): first
 * `InstanceResetSaasGuard` (masks this whole surface as 404 on SaaS — an owner decision specific to
 * the reset flow, see that guard's own header for why it is NOT baked into the shared operator check),
 * then `InstanceOperatorGuard` (API-key refusal + the `INSTANCE_OPERATOR_EMAILS` allowlist, shared
 * with `GET /api/backup/status`). Retires the doctrine `backup.controller.ts` used to hold — "any
 * company's OWNER is trusted with an instance-level action" — see that controller's own updated
 * header.
 */
@ApiTags('instance')
@Controller('instance')
@UseGuards(InstanceResetSaasGuard, InstanceOperatorGuard)
export class InstanceController {
  constructor(
    private readonly preflightService: InstancePreflightService,
    private readonly resetService: InstanceResetService,
  ) {}

  @Get('danger/preflight')
  @ApiOperation({
    summary: 'Instance-reset preflight counts',
    description:
      'How many companies, users and documents an instance-wide reset would delete. Also the sole ' +
      'signal the frontend has for whether this feature exists on this deployment at all — a ' +
      'non-200 response (404 in SaaS, 403 for anyone not an instance operator) hides it entirely.',
  })
  @ApiResponse({ status: 200, description: 'Preflight counts' })
  async getPreflight(): Promise<InstancePreflightView> {
    return this.preflightService.getPreflight();
  }

  @Post('danger/otp')
  @ApiOperation({
    summary: 'Request an OTP for an instance-wide reset',
    description: "Sends a one-time passcode to the requesting operator's own e-mail address.",
  })
  @ApiResponse({ status: 201, description: 'OTP sent' })
  async requestOtp(@User() user: CurrentUser) {
    return this.resetService.requestOtp(user);
  }

  @Post('danger/reset')
  @ApiOperation({
    summary: 'Reset the ENTIRE instance',
    description:
      'Deletes every company, user, document and stored file on this deployment, then signs ' +
      'everyone out. Irreversible. Requires a fresh OTP (POST .../danger/otp) AND typing ' +
      '"RESET INSTANCE" exactly — both in the request BODY, never a query string (see ' +
      "`danger.controller.ts`'s own comment on this for why).",
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['otp', 'confirmationWord'],
      properties: {
        otp: { type: 'string', description: 'One-time passcode sent via POST /instance/danger/otp' },
        confirmationWord: { type: 'string', description: 'Must be exactly "RESET INSTANCE"' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Instance reset' })
  async reset(@User() user: CurrentUser, @Body() body: InstanceResetBody) {
    if (!body?.otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    if (!body?.confirmationWord) {
      throw new BadRequestException('Confirmation word is required for this action');
    }
    return this.resetService.reset(user, body.otp, body.confirmationWord);
  }
}
