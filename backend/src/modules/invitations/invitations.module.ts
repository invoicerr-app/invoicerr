import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { InvitationCodeBackfillService } from './invitation-code-backfill.service';
import { Module } from '@nestjs/common';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InvitationsController],
  providers: [InvitationsService, InvitationCodeBackfillService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
