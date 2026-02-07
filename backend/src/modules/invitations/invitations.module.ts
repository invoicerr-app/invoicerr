import { Module } from "@nestjs/common";
import { PrismaModule } from "@/prisma/prisma.module";
import { InvitationsController } from "./invitations.controller";
import { InvitationsService } from "./invitations.service";

@Module({
	imports: [PrismaModule],
	controllers: [InvitationsController],
	providers: [InvitationsService],
	exports: [InvitationsService],
})
export class InvitationsModule {}
