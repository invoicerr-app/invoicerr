/** Reading the seat plan is open to every member; moving a desk is OWNER/ADMIN only. */
import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { MoveSeatDto } from './billing.dto';
import { getSeatsView, moveMemberSeat, SeatsView } from './seats-view';
import { RequiresScope } from '@/utils/scope-check';

@ApiTags('billing')
@Controller('billing/seats')
export class SeatsController {
  @Get()
  @RequiresScope('billing:read')
  @ApiOperation({
    summary: "The active company's seat plan",
    description:
      'Bought seat quantity (read from the billing provider, never written to it, see billing/seat-sync.ts), who ' +
      'is seated at a numbered desk, and who is waiting for one.',
  })
  @ApiResponse({ status: 200, description: 'Seats view' })
  async getSeats(@ActiveCompany() companyId: string): Promise<SeatsView> {
    return getSeatsView(companyId);
  }

  @Patch(':userId')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('billing:write')
  @ApiOperation({
    summary: 'Move a member to a different desk',
    description: 'Purely visual — a desk number never grants or revokes access.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, description: 'Updated seats view' })
  async moveSeat(
    @ActiveCompany() companyId: string,
    @Param('userId') userId: string,
    @Body() body: MoveSeatDto,
  ): Promise<SeatsView> {
    return moveMemberSeat(companyId, userId, body.seatIndex);
  }
}
