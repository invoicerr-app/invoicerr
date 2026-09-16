/**
 * `Settings > Seats` — the company's own generative office plan. Reading is open to every company
 * member (the same "no `@Roles`" openness `GET /api/companies/members` already has — everyone can see
 * who sits where); moving a member to a different desk is OWNER/ADMIN only, the same pair
 * `billing.controller.ts` restricts checkout/portal to.
 */
import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { getSeatsView, moveMemberSeat, SeatsView } from './seats-view';

@ApiTags('billing')
@Controller('billing/seats')
export class SeatsController {
  @Get()
  @ApiOperation({
    summary: "The active company's seat plan",
    description:
      'Bought seat quantity (read from Polar, never written to it — see billing/seat-sync.ts), who ' +
      'is seated at a numbered desk, and who is waiting for one.',
  })
  @ApiResponse({ status: 200, description: 'Seats view' })
  async getSeats(@ActiveCompany() companyId: string): Promise<SeatsView> {
    return getSeatsView(companyId);
  }

  @Patch(':userId')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Move a member to a different desk',
    description: 'Purely visual — a desk number never grants or revokes access.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, description: 'Updated seats view' })
  async moveSeat(
    @ActiveCompany() companyId: string,
    @Param('userId') userId: string,
    @Body() body: { seatIndex: number },
  ): Promise<SeatsView> {
    return moveMemberSeat(companyId, userId, body.seatIndex);
  }
}
