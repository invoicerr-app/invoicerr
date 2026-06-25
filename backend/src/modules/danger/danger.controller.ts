import { User } from '@/decorators/user.decorator';
import { DangerService } from '@/modules/danger/danger.service';
import { CurrentUser } from '@/types/user';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('danger')
@Controller('danger')
export class DangerController {
  constructor(private readonly dangerService: DangerService) {}

  @Post('otp')
  @ApiOperation({ summary: 'Request OTP for dangerous actions', description: 'Sends a one-time passcode to the user email to authorize destructive operations.' })
  @ApiResponse({ status: 201, description: 'OTP sent' })
  async requestOtp(@User() user: CurrentUser) {
    return this.dangerService.requestOtp(user);
  }

  @Post('reset/app')
  @ApiOperation({ summary: 'Reset app data', description: 'Deletes all documents (invoices, quotes, payments) while preserving company configuration.' })
  @ApiQuery({ name: 'otp', required: true, type: String, description: 'One-time passcode sent via POST /danger/otp' })
  @ApiResponse({ status: 201, description: 'App data reset' })
  async resetApp(@User() user: CurrentUser, @Query('otp') otp: string) {
    if (!otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    return this.dangerService.resetApp(user, otp);
  }

  @Post('reset/all')
  @ApiOperation({ summary: 'Reset everything', description: 'Deletes all data including documents, clients, and company configuration. The app returns to its initial state.' })
  @ApiQuery({ name: 'otp', required: true, type: String, description: 'One-time passcode sent via POST /danger/otp' })
  @ApiResponse({ status: 201, description: 'Everything reset' })
  async resetAll(@User() user: CurrentUser, @Query('otp') otp: string) {
    if (!otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    return this.dangerService.resetAll(user, otp);
  }
}
