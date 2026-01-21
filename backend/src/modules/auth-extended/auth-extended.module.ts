import { Module } from '@nestjs/common';
import { AuthExtendedController } from './auth-extended.controller';

@Module({
  controllers: [AuthExtendedController],
})
export class AuthExtendedModule {}
