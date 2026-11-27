import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { User } from '@/decorators/user.decorator';
import { LegalGateExempt } from '@/legal/legal-gate-exempt.decorator';
import { SeatGateExempt } from '@/modules/billing/seat-gate-exempt.decorator';
import { CurrentUser } from '@/types/user';

import { ERROR_TRACKING_CONSENT_CHANNELS, parseConsentDecisionInput } from './consent-policy';
import { ErrorTrackingConsentService } from './error-tracking-consent.service';

// About the signed-in user, never the active company: a member with no seat, or one with a pending
// legal re-acceptance, must still be able to refuse or withdraw.
@SeatGateExempt()
@ApiTags('error-tracking')
@Controller('error-tracking/consent')
export class ErrorTrackingConsentController {
  constructor(private readonly consentService: ErrorTrackingConsentService) {}

  @Get()
  @ApiOperation({
    summary: "The current user's browser error-reporting decision",
    description:
      'Authenticated. `available` is false when the instance collects no browser error reports. ' +
      '`browser` (collection address, environment, release) is only filled in for a user whose ' +
      'grant is still valid; nothing else about the error tracker is ever returned.',
  })
  @ApiResponse({ status: 200, description: 'Decision retrieved' })
  get(@User() user: CurrentUser) {
    return this.consentService.getView(user.id);
  }

  @Put()
  @LegalGateExempt()
  @ApiOperation({
    summary: 'Grant, refuse or withdraw browser error reporting',
    description:
      'Authenticated. Appends a decision to the user history; `granted: false` after a grant is a ' +
      'withdrawal and takes effect on the next read of this resource.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        granted: { type: 'boolean' },
        channel: { type: 'string', enum: [...ERROR_TRACKING_CONSENT_CHANNELS] },
      },
      required: ['granted', 'channel'],
    },
  })
  @ApiResponse({ status: 200, description: 'Decision recorded' })
  @ApiResponse({ status: 400, description: 'granted is not a boolean, or channel is unknown' })
  decide(@User() user: CurrentUser, @Body() body: unknown) {
    const input = parseConsentDecisionInput(body);
    if (!input) {
      const channels = ERROR_TRACKING_CONSENT_CHANNELS.map((channel) => `"${channel}"`).join(' | ');
      throw new BadRequestException(`Expected { granted: boolean, channel: ${channels} }`);
    }
    return this.consentService.decide(user.id, input.granted, input.channel);
  }
}
