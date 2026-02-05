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

@Controller('danger')
export class DangerController {
  constructor(private readonly dangerService: DangerService) {}

  @Post('otp')
  async requestOtp(@User() user: CurrentUser) {
    return this.dangerService.requestOtp(user);
  }

  @Post('reset/app')
  async resetApp(@User() user: CurrentUser, @Query('otp') otp: string) {
    if (!otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    return this.dangerService.resetApp(user, otp);
  }

  @Post('reset/all')
  async resetAll(@User() user: CurrentUser, @Query('otp') otp: string) {
    if (!otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    return this.dangerService.resetAll(user, otp);
  }
}
