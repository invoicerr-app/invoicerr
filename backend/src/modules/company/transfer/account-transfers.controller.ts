import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';

import { TransferService } from './transfer.service';

/**
 * The RECIPIENT's own side of a company ownership transfer — deliberately account-scoped, not
 * company-scoped: no `@ActiveCompany()`/`@Roles()` (the recipient may not even be a member of the
 * company sending the request yet), and no `@RequiresScope()` either, the same posture
 * `legal.controller.ts` already takes for personal-account routes an API key (always minted for one
 * company) has no natural business calling.
 *
 * `POST :id/accept` carries no `@LegalGateExempt()` — in hosted-billing mode, a caller with a pending
 * legal re-acceptance is refused by the GLOBAL `LegalAcceptanceGuard` before this handler ever runs
 * (see `transfer.service.ts#acceptTransfer`'s own header). The frontend catches that refusal and sends
 * the visitor to `/legal/accept`.
 */
@ApiTags('company-transfer')
@Controller('account/transfers')
export class AccountTransfersController {
  constructor(private readonly transferService: TransferService) {}

  @Get()
  @ApiOperation({
    summary: 'List ownership transfers addressed to my account',
    description: 'Every status, newest first — the pending one(s) are what the acceptance screen acts on.',
  })
  @ApiResponse({ status: 200, description: 'Transfers retrieved' })
  async mine(@User() user: CurrentUser) {
    return this.transferService.listReceivedTransfers(user.id);
  }

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept an ownership transfer',
    description:
      "Must be signed in as the transfer's own recipient. Makes the caller OWNER of the company and " +
      'the initiating OWNER an admin.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 201, description: 'Transfer accepted' })
  @ApiResponse({ status: 404, description: 'No such transfer addressed to this account' })
  @ApiResponse({ status: 409, description: 'No longer pending' })
  @ApiResponse({ status: 410, description: 'Expired' })
  async accept(@Param('id') id: string, @User() user: CurrentUser) {
    return this.transferService.acceptTransfer(id, user.id);
  }
}
