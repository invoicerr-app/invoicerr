import { DirectoryController } from './directory.controller';
import { DirectoryService } from './directory.service';
import { Module } from '@nestjs/common';

@Module({
    controllers: [DirectoryController],
    providers: [DirectoryService],
    exports: [DirectoryService],
})
export class DirectoryModule { }
