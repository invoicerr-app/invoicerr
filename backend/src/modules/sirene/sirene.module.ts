import { Module } from '@nestjs/common';
import { SireneController } from '@/modules/sirene/sirene.controller';
import { SireneService } from '@/modules/sirene/sirene.service';

@Module({
    controllers: [SireneController],
    providers: [SireneService],
})
export class SireneModule { }
