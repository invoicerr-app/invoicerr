import { AuthExtendedController } from './auth-extended.controller';
import { Module } from '@nestjs/common';

@Module({
    controllers: [AuthExtendedController],
})
export class AuthExtendedModule { }
